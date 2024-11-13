let isGenerating = false;
let currentPollInterval = null;
let saveToFileSystem = false;
const generatedImages = new Map();
let currentTab = 'generator';

function showGenerating() {
    const resultDiv = document.getElementById('result');
    if (resultDiv) {
        resultDiv.innerHTML = `
            <div id="imagePlaceholder" class="w-full max-w-md mx-auto bg-gray-200 rounded-md h-64 flex items-center justify-center">
                <div class="text-center">
                    <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mb-4"></div>
                    <div class="text-gray-500" id="statusText">Generating image...</div>
                </div>
            </div>
        `;
    }
}

function updateStatus(status) {
    const statusText = document.getElementById('statusText');
    if (statusText) {
        statusText.textContent = `Status: ${status}`;
    }
    updateSubmitButton(isGenerating);
}

function showError(message) {
    document.getElementById('result').innerHTML = `
        <div class="w-full max-w-md mx-auto p-4 bg-red-50 rounded-md">
            <p class="text-red-800 text-center">${message}</p>
            <p class="text-red-600 text-sm text-center mt-2">Please try again</p>
        </div>
    `;
    updateSubmitButton(false);
}

function showResult(imageSrc) {
    document.getElementById('result').innerHTML = `
        <img src="${imageSrc}" alt="Generated image" class="w-full max-w-md mx-auto rounded-md cursor-pointer" 
             onclick="openModal('${imageSrc}')" />
        ${!saveToFileSystem ? '<button onclick="downloadImage(this)" class="mt-4 px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600">Download Image</button>' : ''}
    `;
    updateSubmitButton(false);
}

function switchTab(tabName) {
    const tabs = ['generator', 'gallery'];
    
    tabs.forEach(tab => {
        const contentElement = document.getElementById(`${tab}Content`);
        const tabElement = document.getElementById(`${tab}Tab`);
        
        if (tab === tabName) {
            contentElement.classList.remove('hidden');
            tabElement.classList.add('tab-active');
            currentTab = tab;
            
            if (tab === 'gallery') {
                updateGalleryView();
            }
        } else {
            contentElement.classList.add('hidden');
            tabElement.classList.remove('tab-active');
        }
    });
}

function updateGalleryView() {
    const galleryContent = document.getElementById('galleryContent');
    
    if (generatedImages.size === 0) {
        galleryContent.innerHTML = `
            <div class="text-center py-12">
                <p class="text-gray-500">No images generated yet</p>
            </div>
        `;
        return;
    }

    const galleryHTML = `
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            ${Array.from(generatedImages.entries()).reverse().map(([timestamp, {data, prompt, fromDisk}]) => `
                <div class="border rounded-lg p-4 hover:shadow-lg transition">
                    <img src="${fromDisk ? data : data}" 
                         alt="Generated image" 
                         class="w-full h-48 object-cover rounded-md cursor-pointer" 
                         onclick="openModal('${fromDisk ? data : data}')" />
                    <p class="mt-2 text-sm text-gray-600 line-clamp-2">${prompt}</p>
                    <p class="text-xs text-gray-400 mt-1">${new Date(timestamp).toLocaleString()}</p>
                    <div class="flex gap-2 mt-2">
                        <button onclick="downloadImage(this)" 
                                data-image="${fromDisk ? data : data}"
                                class="flex-1 px-3 py-1 bg-green-500 text-white rounded text-sm hover:bg-green-600 transition">
                            Download
                        </button>
                        ${!fromDisk ? `
                            <button onclick="deleteImage('${timestamp}')" 
                                    class="px-3 py-1 bg-red-500 text-white rounded text-sm hover:bg-red-600 transition">
                                Delete
                            </button>
                        ` : ''}
                    </div>
                </div>
            `).join('')}
        </div>
    `;
    
    galleryContent.innerHTML = galleryHTML;
}

async function loadDiskImages() {
    try {
        const response = await fetch('/list-images');
        const images = await response.json();
        
        for (const image of images) {
            const timestamp = new Date(image.created).toISOString();
            generatedImages.set(timestamp, {
                data: image.path,
                prompt: image.prompt || 'Unknown prompt',
                fromDisk: true
            });
        }
        updateGalleryCount();
        if (currentTab === 'gallery') {
            updateGalleryView();
        }
    } catch (error) {
        console.error('Failed to load disk images:', error);
    }
}

function downloadImage(button) {
    const imageData = button.dataset.image || button.previousElementSibling?.src;
    if (!imageData) return;
    
    const link = document.createElement('a');
    link.href = imageData;
    link.download = `generated-image-${new Date().getTime()}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function deleteImage(timestamp) {
    if (confirm('Are you sure you want to delete this image?')) {
        generatedImages.delete(timestamp);
        updateGalleryCount();
        updateGalleryView();
    }
}

function updateGalleryCount() {
    const countElement = document.getElementById('galleryCount');
    if (countElement) {
        countElement.textContent = generatedImages.size;
    }
}

// Vervang de bestaande pollResult functie
async function pollResult(id) {
    let attempts = 0;
    const maxAttempts = 60;

    // Clear any existing interval
    if (currentPollInterval) {
        clearInterval(currentPollInterval);
        currentPollInterval = null;
    }

    const poll = async () => {
        if (attempts >= maxAttempts) {
            if (currentPollInterval) {
                clearInterval(currentPollInterval);
                currentPollInterval = null;
            }
            isGenerating = false;
            showError('Generation timeout - please try again');
            return;
        }

        try {
            const response = await fetch(`/get-result?id=${id}&saveToFile=${saveToFileSystem}`);
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Failed to check generation status');
            }

            if (data.status === 'Ready') {
                if (currentPollInterval) {
                    clearInterval(currentPollInterval);
                    currentPollInterval = null;
                }

                if (saveToFileSystem && data.localPath) {
                    const timestamp = new Date().toISOString();
                    generatedImages.set(timestamp, {
                        data: data.localPath,
                        prompt: document.getElementById('prompt').value,
                        fromDisk: true
                    });
                    showResult(data.localPath);
                    updateGalleryCount();
                    if (currentTab === 'gallery') {
                        updateGalleryView();
                    }
                } else if (data.imageData) {
                    const timestamp = new Date().toISOString();
                    generatedImages.set(timestamp, {
                        data: data.imageData,
                        prompt: document.getElementById('prompt').value
                    });
                    showResult(data.imageData);
                    updateGalleryCount();
                    if (currentTab === 'gallery') {
                        updateGalleryView();
                    }
                }
                isGenerating = false;
                return;
            } else if (data.status === 'Error') {
                if (currentPollInterval) {
                    clearInterval(currentPollInterval);
                    currentPollInterval = null;
                }
                isGenerating = false;
                throw new Error(data.result?.error || 'Generation failed');
            }
            
            updateStatus(data.status);
            attempts++;
        } catch (error) {
            if (currentPollInterval) {
                clearInterval(currentPollInterval);
                currentPollInterval = null;
            }
            isGenerating = false;
            showError(error.message || 'Failed to check generation status');
        }
    };

    // Initial poll
    await poll();

    // Set up interval for subsequent polls
    currentPollInterval = setInterval(poll, 1000);
}

// Optionally add a cleanup function for when the page unloads
window.addEventListener('beforeunload', () => {
    if (currentPollInterval) {
        clearInterval(currentPollInterval);
        currentPollInterval = null;
    }
});

function buildPayload(model, prompt) {
    const payload = {
        model,
        prompt,
        output_format: 'jpeg',
        safety_tolerance: parseInt(document.getElementById('safety_tolerance').value) || 2
    };

    const seed = document.getElementById('seed').value;
    if (seed) {
        payload.seed = parseInt(seed);
    }

    switch(model) {
        case 'flux-pro-1.1-ultra':
            payload.aspect_ratio = document.getElementById('aspect_ratio').value || '16:9';
            payload.raw = document.getElementById('raw').checked;
            break;

        case 'flux-pro-1.1':
            payload.width = parseInt(document.getElementById('width').value) || 1024;
            payload.height = parseInt(document.getElementById('height').value) || 768;
            payload.prompt_upsampling = document.getElementById('prompt_upsampling').checked;
            break;

        case 'flux-pro':
            payload.width = parseInt(document.getElementById('width').value) || 1024;
            payload.height = parseInt(document.getElementById('height').value) || 768;
            payload.steps = parseInt(document.getElementById('steps').value) || 40;
            payload.guidance = parseFloat(document.getElementById('guidance').value) || 2.5;
            payload.interval = parseInt(document.getElementById('interval').value) || 2;
            payload.prompt_upsampling = document.getElementById('prompt_upsampling').checked;
            break;

        case 'flux-dev':
            payload.width = parseInt(document.getElementById('width').value) || 1024;
            payload.height = parseInt(document.getElementById('height').value) || 768;
            payload.steps = parseInt(document.getElementById('steps').value) || 28;
            payload.guidance = parseFloat(document.getElementById('guidance').value) || 3;
            payload.prompt_upsampling = document.getElementById('prompt_upsampling').checked;
            break;
    }

    return payload;
}

async function submitForm() {
    if (isGenerating) {
        console.log('Generation already in progress');
        return;
    }

    try {
        isGenerating = true;
        updateSubmitButton(true);
        
        const errorMessage = document.getElementById('errorMessage');
        if (errorMessage) errorMessage.textContent = '';
        
        const model = document.getElementById('model').value;
        const prompt = document.getElementById('prompt').value.trim();
        
        if (!prompt) {
            showError('Prompt is required');
            isGenerating = false;
            updateSubmitButton(false);
            return;
        }

        showGenerating();

        const payload = buildPayload(model, prompt);
        console.log('Sending payload:', payload);

        const response = await fetch('/create-request', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        console.log('Received response:', response.status, data);

        if (!response.ok) {
            handleErrorResponse(response.status, data);
            isGenerating = false;
            updateSubmitButton(false);
            return;
        }

        if (data.id) {
            await pollResult(data.id);
        } else {
            throw new Error('No request ID received');
        }
    } catch (error) {
        console.error('Error:', error);
        showError(error.message || 'An error occurred');
    } finally {
        isGenerating = false;
        updateSubmitButton(false);
    }
}

function handleErrorResponse(status, data) {
    switch (status) {
        case 402:
            showError(`Insufficient Credits. Please visit <a href="${data.url || 'https://api.bfl.ml'}" target="_blank" class="underline hover:text-red-800">api.bfl.ml</a> to add more credits.`);
            break;
        case 422:
            showError(data.error || 'Validation error');
            break;
        case 401:
            showError('Invalid API key. Please check your configuration.');
            break;
        default:
            showError(data.error || 'An error occurred while processing your request');
    }
}

function updateSubmitButton(disabled = false) {
    const submitButton = document.querySelector('button[onclick="submitForm()"]');
    if (submitButton) {
        submitButton.disabled = disabled;
        submitButton.classList.toggle('opacity-50', disabled);
        submitButton.classList.toggle('cursor-not-allowed', disabled);
    }
}

document.addEventListener('DOMContentLoaded', function() {
    const storageToggle = document.getElementById('saveToFileSystem');
    loadDiskImages();
    if (storageToggle) {
        storageToggle.addEventListener('change', function(e) {
            saveToFileSystem = e.target.checked;
            localStorage.setItem('saveToFileSystem', saveToFileSystem);
        });

        const savedPreference = localStorage.getItem('saveToFileSystem');
        if (savedPreference !== null) {
            saveToFileSystem = savedPreference === 'true';
            storageToggle.checked = saveToFileSystem;
        }
    }

    const toggleButton = document.getElementById('toggleAdvanced');
    if (toggleButton) {
        const advancedOptions = document.getElementById('advancedOptions');
        advancedOptions.classList.remove('hidden');
        toggleButton.textContent = 'Hide Advanced Options';

        toggleButton.addEventListener('click', function() {
            const advancedOptions = document.getElementById('advancedOptions');
            const isHidden = advancedOptions.classList.contains('hidden');
            advancedOptions.classList.toggle('hidden');
            this.textContent = isHidden ? 'Hide Advanced Options' : 'Show Advanced Options';
        });
    }

    const modelSelect = document.getElementById('model');
    if (modelSelect) {
        function updateModelOptions(model) {
            const allOptions = document.querySelectorAll('.model-option');
            allOptions.forEach(el => el.classList.add('hidden'));
            
            document.querySelectorAll('.common-option').forEach(el => el.classList.remove('hidden'));
            
            switch(model) {
                case 'flux-pro-1.1-ultra':
                    document.querySelectorAll('.ultra-option').forEach(el => el.classList.remove('hidden'));
                    break;
                case 'flux-pro-1.1':
                    document.querySelectorAll('.basic-option').forEach(el => el.classList.remove('hidden'));
                    break;
                case 'flux-pro':
                    document.querySelectorAll('.pro-option, .basic-option').forEach(el => el.classList.remove('hidden'));
                    document.getElementById('interval')?.closest('.model-option')?.classList.remove('hidden');
                    break;
                case 'flux-dev':
                    document.querySelectorAll('.dev-option, .basic-option').forEach(el => el.classList.remove('hidden'));
                    break;
            }
        }

        modelSelect.value = 'flux-pro-1.1-ultra';
        updateModelOptions('flux-pro-1.1-ultra');
        modelSelect.addEventListener('change', function() {
            updateModelOptions(this.value);
        });
    }

    switchTab('generator');
});