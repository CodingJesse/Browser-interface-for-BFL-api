const express = require('express');
const axios = require('axios');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs'); 

const imagesDir = path.join(__dirname, 'public', 'images');
if (!fsSync.existsSync(imagesDir)) {
    fsSync.mkdirSync(imagesDir, { recursive: true });
}

const API_KEY = process.env.API_KEY;
const BASE_URL = process.env.BASE_URL || 'https://api.bfl.ml';

const MODEL_ENDPOINTS = {
    'flux-pro-1.1': 'flux-pro-1.1',
    'flux-pro': 'flux-pro',
    'flux-dev': 'flux-dev',
    'flux-pro-1.1-ultra': 'flux-pro-1.1-ultra'
};

async function getNextImageName(directory) {
        try {
            if (!fsSync.existsSync(directory)) {
                await fs.mkdir(directory, { recursive: true });
                return 'image1.jpg';
            }
    
            const files = await fs.readdir(directory);
            const imageFiles = files.filter(file => file.match(/^image\d+\.jpg$/));
            
            if (imageFiles.length === 0) {
                return 'image1.jpg';
            }
    
            const numbers = imageFiles
                .map(file => parseInt(file.match(/^image(\d+)\.jpg$/)[1]))
                .sort((a, b) => b - a);
            
            return `image${numbers[0] + 1}.jpg`;
        } catch (error) {
            console.error('Error generating image name:', error);
            return `image${Date.now()}.jpg`; 
        }
    }
    
   

    router.get('/list-images', async (req, res) => {
        try {
            const files = await fs.readdir(imagesDir);
            const images = await Promise.all(
                files
                    .filter(file => file.endsWith('.jpg'))
                    .map(async (file) => {
                        const stats = await fs.stat(path.join(imagesDir, file));
                        return {
                            path: `/images/${file}`,
                            created: stats.mtime,
                            prompt: 'Generated image'
                        };
                    })
            );
            
            images.sort((b, a) => b.created - a.created);
            
            res.json(images);
        } catch (error) {
            console.error('Failed to list images:', error);
            res.status(500).json({ error: 'Failed to list images' });
        }
    });

router.post('/create-request', async (req, res) => {
    try {
        const { model, ...requestData } = req.body;
        
        if (!model) {
            return res.status(400).json({ error: 'Model parameter is required' });
        }

        if (!API_KEY) {
            return res.status(500).json({ error: 'API key is not configured' });
        }

        const endpoint = MODEL_ENDPOINTS[model];
        if (!endpoint) {
            return res.status(400).json({ error: 'Invalid model selected' });
        }

        const apiUrl = `${BASE_URL}/v1/${endpoint}`;
        console.log('Sending request to:', apiUrl);
        console.log('With payload:', requestData);

        const response = await axios.post(
            apiUrl,
            requestData,
            {
                headers: {
                    'Accept': 'application/json',
                    'x-key': API_KEY,
                    'Content-Type': 'application/json',
                },
                validateStatus: false
            }
        );

        console.log('API Response:', {
            status: response.status,
            data: response.data,
            headers: response.headers
        });

        if (response.status === 402) {
            return res.status(402).json({
                error: 'Insufficient credits',
                detail: 'Please add more credits to your account.',
                url: 'https://api.bfl.ml'
            });
        }

        if (response.status !== 200) {
            return res.status(response.status).json({
                error: response.data.detail || response.data.error || 'API Error',
                detail: response.data
            });
        }

        res.json({ id: response.data.id });

    } catch (error) {
        console.error('Server error:', error);

        if (error.response) {
            return res.status(error.response.status || 500).json({
                error: error.response.data.detail || error.response.data.error || 'API Error',
                detail: error.response.data
            });
        }

        res.status(500).json({
            error: 'Server error',
            detail: error.message
        });
    }
});

router.get('/get-result', async (req, res) => {
    try {
        const { id, saveToFile } = req.query;
        
        if (!id) {
            return res.status(400).json({ error: 'ID is required' });
        }

        const response = await axios.get(`${BASE_URL}/v1/get_result`, {
            headers: {
                'Accept': 'application/json',
                'x-key': API_KEY,
            },
            params: { id },
            validateStatus: false
        });

        console.log('Get Result Response:', {
            status: response.status,
            data: response.data
        });

        if (response.status !== 200) {
            return res.status(response.status).json({
                error: response.data.detail || response.data.error || 'API Error',
                detail: response.data
            });
        }

        if (!response.data.status) {
            return res.status(500).json({
                error: 'Invalid response format',
                detail: 'Status field missing in response'
            });
        }

        if (response.data.status === 'Ready' && response.data.result && response.data.result.sample) {
            try {
                const imageUrl = response.data.result.sample;
                const imageResponse = await axios.get(imageUrl, { 
                    responseType: 'arraybuffer',
                    validateStatus: false
                });

                if (imageResponse.status !== 200) {
                    throw new Error('Failed to download image');
                }

                const imageBuffer = Buffer.from(imageResponse.data);

                if (saveToFile === 'true') {
                    if (!fsSync.existsSync(imagesDir)) {
                        await fs.mkdir(imagesDir, { recursive: true });
                    }

                    const imageName = await getNextImageName(imagesDir);
                    const imagePath = path.join(imagesDir, imageName);
                    
                    try {
                        await fs.writeFile(imagePath, imageBuffer);
                        console.log(`Image saved successfully to ${imagePath}`);
                        response.data.localPath = `/images/${imageName}`;
                    } catch (writeError) {
                        console.error('Failed to write image:', writeError);
                        const base64Image = imageBuffer.toString('base64');
                        response.data.imageData = `data:image/jpeg;base64,${base64Image}`;
                    }
                } else {
                    const base64Image = imageBuffer.toString('base64');
                    response.data.imageData = `data:image/jpeg;base64,${base64Image}`;
                }
            } catch (imageError) {
                console.error('Image download error:', imageError);
                return res.status(500).json({
                    error: 'Failed to download image',
                    detail: imageError.message
                });
            }
        }

        res.json(response.data);
    } catch (error) {
        console.error('Get result error:', error);
        res.status(500).json({
            error: error.response?.data?.error || 'Failed to get result',
            detail: error.message
        });
    }
});

module.exports = router;