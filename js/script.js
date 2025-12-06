document.addEventListener('DOMContentLoaded', () => {
    // --- THEME MANAGEMENT ---
    const themeSelect = document.getElementById('theme-select');
    const savedTheme = localStorage.getItem('gemini3-theme') || 'cyber';
    
    // Apply saved theme immediately
    document.documentElement.setAttribute('data-theme', savedTheme);
    if(themeSelect) themeSelect.value = savedTheme;

    if(themeSelect) {
        themeSelect.addEventListener('change', (e) => {
            const theme = e.target.value;
            document.documentElement.setAttribute('data-theme', theme);
            localStorage.setItem('gemini3-theme', theme);
        });

    }

    // --- TYPING EFFECT ---
    const typeWriter = (element, text, speed = 50) => {
        element.innerHTML = '';
        element.style.borderRight = '3px solid var(--primary)'; // Add cursor
        
        let i = 0;
        const timer = setInterval(() => {
            if (i < text.length) {
                element.innerHTML += text.charAt(i);
                i++;
            } else {
                clearInterval(timer);
                element.style.borderRight = 'none'; // Remove cursor when done
                // Optional: Add blinking cursor at the end
                // element.innerHTML += '<span class="typing-cursor">&nbsp;</span>';
            }
        }, speed);
    };

    const initTypingEffect = () => {
        const activeTab = document.querySelector('.tab-content.active');
        if (!activeTab) return;

        const h1 = activeTab.querySelector('.hero-text h1');
        const p = activeTab.querySelector('.hero-text p');

        if (h1 && !h1.dataset.typed) {
            const text = h1.innerText;
            h1.dataset.typed = "true"; // Prevent re-typing
            typeWriter(h1, text, 50);
        }
        
        if (p && !p.dataset.typed) {
            const text = p.innerText;
            p.dataset.typed = "true";
            // Start paragraph typing after a delay
            setTimeout(() => {
                typeWriter(p, text, 30);
            }, 1000);
        }
    };

    // Initialize on load
    setTimeout(initTypingEffect, 100);

    // --- TAB SWITCHING ---
    const navBtns = document.querySelectorAll('.nav-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            navBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            const tabId = btn.dataset.tab + '-section';
            document.getElementById(tabId).classList.add('active');
            
            // Re-trigger typing effect for the new tab
            const newTab = document.getElementById(tabId);
            const h1 = newTab.querySelector('.hero-text h1');
            const p = newTab.querySelector('.hero-text p');
            
            // Reset for re-typing (optional, remove if you only want it once)
            if (h1) { h1.dataset.typed = ""; h1.innerText = h1.getAttribute('data-original-text') || h1.innerText; h1.setAttribute('data-original-text', h1.innerText); }
            if (p) { p.dataset.typed = ""; p.innerText = p.getAttribute('data-original-text') || p.innerText; p.setAttribute('data-original-text', p.innerText); }

            initTypingEffect();
        });
    });

    // --- CONVERTER MODE SWITCHING ---
    const modeBtns = document.querySelectorAll('.mode-btn');
    const modeContents = document.querySelectorAll('.mode-content');

    modeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            modeBtns.forEach(b => b.classList.remove('active'));
            modeContents.forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            const modeId = btn.dataset.mode + '-mode';
            document.getElementById(modeId).classList.add('active');
        });
    });

    // --- DOWNLOAD LOGIC ---
    const downloadBtn = document.getElementById('download-btn');
    const downloadStatus = document.getElementById('download-status');
    const urlInput = document.getElementById('url-input');
    const clearBtn = document.getElementById('clear-btn');
    const qualitySelect = document.getElementById('quality-select');
    const platformBadge = document.getElementById('platform-badge');

    // Platform Detection
    const detectPlatform = (url) => {
        if (!url) return { name: 'Auto', icon: 'fa-globe' };
        
        if (url.includes('tiktok.com')) return { name: 'TikTok', icon: 'fa-brands fa-tiktok' };
        if (url.includes('instagram.com')) return { name: 'Instagram', icon: 'fa-brands fa-instagram' };
        if (url.includes('facebook.com') || url.includes('fb.watch')) return { name: 'Facebook', icon: 'fa-brands fa-facebook' };
        if (url.includes('snapchat.com')) return { name: 'Snapchat', icon: 'fa-brands fa-snapchat' };
        if (url.includes('youtube.com') || url.includes('youtu.be')) return { name: 'YouTube', icon: 'fa-brands fa-youtube' };
        
        return { name: 'Lien Web', icon: 'fa-solid fa-link' };
    };

    const updatePlatformBadge = (url) => {
        const platform = detectPlatform(url);
        platformBadge.innerHTML = `<i class="${platform.icon}"></i> ${platform.name}`;
        
        // YouTube is now enabled on Hugging Face!
        const ytWarning = document.getElementById('yt-warning');
        if (ytWarning) ytWarning.classList.add('hidden');
    };

    urlInput.addEventListener('input', (e) => {
        updatePlatformBadge(e.target.value);
        toggleClearBtn();
    });

    const toggleClearBtn = () => {
        if (urlInput.value.trim() !== '') {
            clearBtn.classList.remove('hidden');
        } else {
            clearBtn.classList.add('hidden');
        }
    };

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            urlInput.value = '';
            updatePlatformBadge('');
            toggleClearBtn();
            urlInput.focus();
        });
    }

    // Auto-Paste & Auto-Download Logic
    const handleAutoAction = async () => {
        try {
            // Check if input is empty to avoid overwriting user input if they are typing
            if (!urlInput.value) {
                const text = await navigator.clipboard.readText();
                if (text && (text.startsWith('http://') || text.startsWith('https://'))) {
                    urlInput.value = text;
                    updatePlatformBadge(text);
                    toggleClearBtn();
                    
                    // Trigger download automatically -> DISABLED as per user request
                    console.log("Auto-detected URL, pasted but NOT downloading.");
                    // downloadBtn.click(); 
                }
            }
        } catch (err) {
            // Clipboard access might be denied or not available
            console.log('Clipboard access denied or empty');
        }
    };

    // Check on load
    // Note: Browsers often block clipboard read on load without user interaction.
    // We try anyway, but 'focus' is more reliable.
    setTimeout(handleAutoAction, 500);

    // Check on window focus (when user comes back to the tab)
    window.addEventListener('focus', handleAutoAction);

    // --- NOTIFICATIONS ---
    const requestNotificationPermission = () => {
        if ('Notification' in window) {
            Notification.requestPermission().then(permission => {
                console.log('Notification permission:', permission);
            });
        }
    };
    
    // Request permission on load
    requestNotificationPermission();


    // Download Function
    let currentTaskId = null;
    let pollInterval = null;

    const resetDownloadState = () => {
        if (pollInterval) clearInterval(pollInterval);
        pollInterval = null;
        currentTaskId = null;
        downloadBtn.disabled = false;
        downloadBtn.style.opacity = '1';
        
        const cancelBtn = document.getElementById('cancel-btn');
        if (cancelBtn) {
            cancelBtn.classList.add('hidden');
        }
    };

    document.getElementById('cancel-btn').addEventListener('click', async () => {
        if (currentTaskId) {
            try {
                await fetch(`/api/download/cancel/${currentTaskId}`, { method: 'POST' });
                downloadStatus.innerHTML = `<p style="color: var(--secondary);">Annulation en cours...</p>`;
            } catch (error) {
                console.error('Error cancelling:', error);
            }
        }
    });

    downloadBtn.addEventListener('click', async () => {
        const url = urlInput.value;
        if (!url) {
            alert('Veuillez coller un lien d\'abord !');
            return;
        }

        downloadBtn.disabled = true;
        downloadBtn.style.opacity = '0.7';
        downloadStatus.classList.remove('hidden');
        document.getElementById('cancel-btn').classList.remove('hidden');
        
        // Initial Status UI
        downloadStatus.innerHTML = `
            <div class="loader"></div>
            <p>Démarrage...</p>
            <div style="width: 100%; background: rgba(255,255,255,0.1); height: 4px; border-radius: 2px; margin-top: 5px;">
                <div id="progress-bar" style="width: 0%; background: var(--primary); height: 100%; border-radius: 2px; transition: width 0.3s;"></div>
            </div>
            <p id="progress-text" style="font-size: 0.8rem; margin-top: 2px;">0%</p>
            <button id="cancel-btn" class="cancel-btn">
                <i class="fa-solid fa-xmark"></i> Annuler
            </button>
        `;

        // Re-attach cancel listener since we overwrote innerHTML
        document.getElementById('cancel-btn').addEventListener('click', async () => {
            if (currentTaskId) {
                try {
                    await fetch(`/api/download/cancel/${currentTaskId}`, { method: 'POST' });
                    // UI update will happen via polling
                } catch (error) {
                    console.error('Error cancelling:', error);
                }
            }
        });

        const progressBar = document.getElementById('progress-bar');
        const progressText = document.getElementById('progress-text');

        try {
            // Start Download
            const response = await fetch('/api/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: url,
                    quality: qualitySelect.value
                })
            });

            const data = await response.json();
            
            if (data.error) throw new Error(data.error);
            
            currentTaskId = data.task_id;

            // Start Polling
            pollInterval = setInterval(async () => {
                try {
                    const statusRes = await fetch(`/api/download/status/${currentTaskId}`);
                    const statusData = await statusRes.json();

                    if (statusData.status === 'downloading') {
                        const progress = statusData.progress || 0;
                        progressBar.style.width = `${progress}%`;
                        progressText.innerText = `${Math.round(progress)}%`;
                    } else if (statusData.status === 'completed') {
                        resetDownloadState();
                        // downloadStatus.innerHTML = ... (OLD)
                        
                        // Show Success Modal
                        const successModal = document.getElementById('success-modal');
                        const successLink = document.getElementById('success-download-link');
                        const closeSuccess = document.getElementById('close-success');
                        
                        successLink.href = statusData.result.download_url;
                        successModal.classList.remove('hidden');
                        setTimeout(() => successModal.classList.add('active'), 10);
                        
                        closeSuccess.onclick = () => {
                            successModal.classList.remove('active');
                            setTimeout(() => successModal.classList.add('hidden'), 300);
                        };
                        
                        // Send Notification
                        if ('Notification' in window && Notification.permission === 'granted') {
                            new Notification('MediaMaster', {
                                body: 'Votre téléchargement est terminé !',
                                icon: '/favicon.ico'
                            });
                        }
                    } else if (statusData.status === 'cancelled') {
                        resetDownloadState();
                        downloadStatus.innerHTML = `<p style="color: var(--secondary);">Téléchargement annulé.</p>`;
                    } else if (statusData.status === 'error') {
                        resetDownloadState();
                        throw new Error(statusData.error || 'Erreur inconnue');
                    }
                } catch (err) {
                    resetDownloadState();
                    console.error('Polling error:', err);
                    downloadStatus.innerHTML = `<p style="color: var(--secondary);">Erreur: ${err.message}</p>`;
                }
            }, 1000);

        } catch (error) {
            resetDownloadState();
            console.error('Error:', error);
            downloadStatus.innerHTML = `<p style="color: var(--secondary);">Erreur: ${error.message}</p>`;
        }
    });

    // --- CONVERT LOGIC ---
    const convertBtn = document.getElementById('convert-btn');
    
    convertBtn.addEventListener('click', async () => {
        const activeMode = document.querySelector('.mode-btn.active').dataset.mode;
        
        convertBtn.disabled = true;
        convertBtn.innerHTML = '<div class="loader" style="width: 20px; height: 20px; border-width: 2px;"></div> Traitement...';
        
        try {
            let endpoint = '';
            let body = null;
            let headers = {};

            if (activeMode === 'video-audio') {
                const fileInput = document.getElementById('file-input');
                if (fileInput.files.length === 0) {
                    throw new Error('Veuillez sélectionner une vidéo.');
                }
                endpoint = '/api/convert-video';
                const formData = new FormData();
                formData.append('file', fileInput.files[0]);
                body = formData;
            } else {
                const textInput = document.getElementById('text-input');
                const voiceSelect = document.getElementById('voice-select');
                if (!textInput.value) {
                    throw new Error('Veuillez entrer du texte.');
                }
                endpoint = '/api/convert-text';
                body = JSON.stringify({
                    text: textInput.value,
                    voice: voiceSelect.value
                });
                headers = { 'Content-Type': 'application/json' };
            }

            const response = await fetch(`${endpoint}`, {
                method: 'POST',
                headers: headers,
                body: body
            });

            const data = await response.json();

            if (data.success) {
                // Direct Download Logic
                const link = document.createElement('a');
                link.href = data.download_url;
                link.download = data.filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                
                alert('Conversion terminée ! Le téléchargement a commencé.');
            } else {
                throw new Error(data.error);
            }

        } catch (error) {
            console.error('Error:', error);
            alert('Erreur : ' + error.message);
        } finally {
            convertBtn.disabled = false;
            convertBtn.innerHTML = '<span>Convertir</span><i class="fa-solid fa-wand-magic"></i>';
        }
    });

    // Paste Button
    const pasteBtn = document.getElementById('paste-btn');
    pasteBtn.addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            urlInput.value = text;
            updatePlatformBadge(text);
            toggleClearBtn();
        } catch (err) {
            console.error('Failed to read clipboard contents: ', err);
            alert('Impossible d\'accéder au presse-papier. Veuillez coller manuellement.');
        }
    });

    // Drop Zone Click
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');

    if(dropZone && fileInput) {
        dropZone.addEventListener('click', () => {
            fileInput.click();
        });

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                dropZone.querySelector('p').textContent = `Fichier sélectionné : ${e.target.files[0].name}`;
                dropZone.style.borderColor = 'var(--primary)';
            }
        });
    }

    // Document Upload Logic
    const docUploadBtn = document.getElementById('doc-upload-btn');
    const docInput = document.getElementById('doc-input');
    const textInput = document.getElementById('text-input');

    if (docUploadBtn && docInput) {
        docUploadBtn.addEventListener('click', () => {
            docInput.click();
        });

        docInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                const file = e.target.files[0];
                const reader = new FileReader();
                
                reader.onload = (e) => {
                    textInput.value = e.target.result;
                };
                
                reader.readAsText(file);
            }
        });
    }

    // Profile Picture Modal
    const profilePic = document.querySelector('.profile-pic');
    const modal = document.getElementById('image-modal');
    const modalImg = document.getElementById('modal-img');
    const closeModal = document.querySelector('.close-modal');

    if (profilePic && modal && modalImg) {
        profilePic.addEventListener('click', () => {
            modal.classList.remove('hidden');
            // Small delay to allow display:flex to apply before opacity transition
            setTimeout(() => {
                modal.classList.add('active');
            }, 10);
            modalImg.src = profilePic.src;
        });

        const hideModal = () => {
            modal.classList.remove('active');
            setTimeout(() => {
                modal.classList.add('hidden');
            }, 300); // Wait for transition
        };

        if (closeModal) {
            closeModal.addEventListener('click', hideModal);
        }

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                hideModal();
            }
        });
    }

    // --- IMAGE CONVERTER LOGIC ---
    const imageDropZone = document.getElementById('image-drop-zone');
    const imageInput = document.getElementById('image-input');
    const convertImageBtn = document.getElementById('convert-image-btn');
    const imageFormatSelect = document.getElementById('image-format-select');

    if (imageDropZone && imageInput) {
        imageDropZone.addEventListener('click', () => imageInput.click());

        imageDropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            imageDropZone.style.borderColor = 'var(--primary)';
        });

        imageDropZone.addEventListener('dragleave', () => {
            imageDropZone.style.borderColor = 'rgba(255, 255, 255, 0.3)';
        });

        imageDropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            imageDropZone.style.borderColor = 'rgba(255, 255, 255, 0.3)';
            if (e.dataTransfer.files.length) {
                imageInput.files = e.dataTransfer.files;
                updateImageDropZoneText(e.dataTransfer.files[0].name);
            }
        });

        imageInput.addEventListener('change', () => {
            if (imageInput.files.length) {
                updateImageDropZoneText(imageInput.files[0].name);
            }
        });
    }

    function updateImageDropZoneText(filename) {
        const p = imageDropZone.querySelector('p');
        p.innerHTML = `<i class="fa-solid fa-check"></i> ${filename}`;
    }

    if (convertImageBtn) {
        convertImageBtn.addEventListener('click', async () => {
            if (!imageInput.files.length) {
                alert('Veuillez sélectionner une image d\'abord.');
                return;
            }

            const file = imageInput.files[0];
            const format = imageFormatSelect.value;
            const formData = new FormData();
            formData.append('file', file);
            formData.append('format', format);

            convertImageBtn.disabled = true;
            convertImageBtn.innerHTML = '<div class="loader" style="width: 20px; height: 20px; border-width: 2px;"></div> Conversion...';

            try {
                const response = await fetch('/api/convert-image', {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) throw new Error('Erreur de conversion');

                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                
                // Get filename
                let filename = `converted.${format}`;
                const contentDisposition = response.headers.get('Content-Disposition');
                if (contentDisposition) {
                    const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
                    if (filenameMatch) filename = filenameMatch[1];
                }
                
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                
                alert('Conversion réussie !');
            } catch (error) {
                console.error(error);
                alert('Une erreur est survenue lors de la conversion.');
            } finally {
                convertImageBtn.disabled = false;
                convertImageBtn.innerHTML = '<span>Convertir l\'Image</span><i class="fa-solid fa-wand-magic"></i>';
            }
        });
    }
});
