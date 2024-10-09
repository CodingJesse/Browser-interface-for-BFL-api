const express = require('express');
const axios = require('axios');
const router = express.Router();
const path = require('path');
const fs = require('fs');

const imagesDir = path.join(__dirname, 'public', 'images');
if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir, { recursive: true });
}

const API_KEY = process.env.API_KEY;
const BASE_URL = process.env.BASE_URL || 'https://api.bfl.ml';

router.post('/create-request', async (req, res) => {
  const {
    prompt,
    model,
    width,
    height,
    steps,
    guidance,
    seed,
    safety_tolerance,
    prompt_upsampling,
  } = req.body;

  let payload = {
    prompt,
    width: parseInt(width) || 1024,
    height: parseInt(height) || 768,
    prompt_upsampling: !!prompt_upsampling,
    seed: seed ? parseInt(seed) : undefined,
    safety_tolerance: safety_tolerance ? parseInt(safety_tolerance) : undefined,
  };

  if (model !== 'flux-pro-1.1') {
    payload.steps = steps ? parseInt(steps) : undefined;
    payload.guidance = guidance ? parseFloat(guidance) : undefined;
  }

  try {
    const response = await axios.post(
      `${BASE_URL}/v1/${model}`,
      payload,
      {
        headers: {
          'Accept': 'application/json',
          'x-key': API_KEY,
          'Content-Type': 'application/json',
        },
      }
    );
    res.json({ id: response.data.id });
  } catch (error) {
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

router.get('/get-result', async (req, res) => {
  const { id } = req.query;
  try {
    const result = await axios.get(`${BASE_URL}/v1/get_result`, {
      headers: {
        'Accept': 'application/json',
        'x-key': API_KEY,
      },
      params: { id },
    });

    if (result.data.status === 'Ready' && result.data.result && result.data.result.sample) {
      const imageUrl = result.data.result.sample;
      const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      const imageBuffer = Buffer.from(imageResponse.data, 'binary');
      const imageName = `image_${id}.jpg`;
      const imagePath = path.join(imagesDir, imageName);

      fs.writeFileSync(imagePath, imageBuffer);

      result.data.localPath = `/images/${imageName}`;
    }

    res.json(result.data);
  } catch (error) {
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

module.exports = router;
