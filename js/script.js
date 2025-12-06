document.addEventListener('DOMContentLoaded', () => {
    // --- NOTIFICATION SOUND ---
    const playNotificationSound = () => {
        // Simple "Ding" sound using AudioContext to avoid external files
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        
        const ctx = new AudioContext();
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);
        
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
        oscillator.frequency.exponentialRampToValueAtTime(1046.5, ctx.currentTime + 0.1); // C6
        
        gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        
        oscillator.start();
        oscillator.stop(ctx.currentTime + 0.5);
    };

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

    // --- MOBILE MENU TOGGLE (Tailwind) ---
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const navLinks = document.getElementById('nav-links');

    if (mobileMenuBtn && navLinks) {
        mobileMenuBtn.addEventListener('click', () => {
            navLinks.classList.toggle('hidden');
            navLinks.classList.toggle('flex');
            
            // Toggle icon
            const icon = mobileMenuBtn.querySelector('i');
            if (!navLinks.classList.contains('hidden')) {
                icon.classList.remove('fa-bars');
                icon.classList.add('fa-times');
            } else {
                icon.classList.remove('fa-times');
                icon.classList.add('fa-bars');
            }
        });

        // Close menu when clicking a link
        const navItems = navLinks.querySelectorAll('.nav-btn');
        navItems.forEach(item => {
            item.addEventListener('click', () => {
                if(window.innerWidth < 768) {
                    navLinks.classList.add('hidden');
                    navLinks.classList.remove('flex');
                    const icon = mobileMenuBtn.querySelector('i');
                    icon.classList.remove('fa-times');
                    icon.classList.add('fa-bars');
                }
            });
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
            navBtns.forEach(b => b.classList.remove('active', 'text-text-main', 'bg-glass-border'));
            b => b.classList.add('text-text-muted');
            
            tabContents.forEach(c => {
                c.classList.add('hidden');
                c.classList.remove('active');
            });

            // Activate button
            btn.classList.add('active', 'text-text-main', 'bg-glass-border');
            btn.classList.remove('text-text-muted');
            
            const tabId = btn.dataset.tab + '-section';
            const newTab = document.getElementById(tabId);
            
            if (newTab) {
                newTab.classList.remove('hidden');
                newTab.classList.add('active'); // For typing effect selector
                
                // Re-trigger typing effect
                const h1 = newTab.querySelector('.hero-text h1');
                const p = newTab.querySelector('.hero-text p');
                
                if (h1) { h1.dataset.typed = ""; h1.innerText = h1.getAttribute('data-original-text') || h1.innerText; h1.setAttribute('data-original-text', h1.innerText); }
                if (p) { p.dataset.typed = ""; p.innerText = p.getAttribute('data-original-text') || p.innerText; p.setAttribute('data-original-text', p.innerText); }

                initTypingEffect();
            }
            
            if (btn.dataset.tab === 'history') {
                fetchHistory();
            }
        });
    });

    // History Fetch Function
    async function fetchHistory() {
        const tbody = document.getElementById('history-table-body');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center"><div class="loader inline-block"></div> Chargement...</td></tr>';
        
        try {
            const res = await fetch('/api/history');
            const data = await res.json();
            
            if (data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center">Aucune action enregistrée</td></tr>';
                return;
            }
            
            tbody.innerHTML = data.map(item => `
                <tr class="border-b border-glass-border hover:bg-glass/5 transition-colors">
                    <td class="p-4">${item.timestamp}</td>
                    <td class="p-4 font-bold text-white">${item.action}</td>
                    <td class="p-4 text-sm font-mono text-gray-300">${item.filename}</td>
                    <td class="p-4">
                        <span class="px-3 py-1 rounded-full text-xs font-bold ${item.status === 'success' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}">
                            ${item.status === 'success' ? 'SUCCÈS' : 'ÉCHEC'}
                        </span>
                    </td>
                </tr>
            `).join('');
            
        } catch (e) {
            tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-red-400">Erreur de chargement historique.</td></tr>';
        }
    }

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
        
        const ytWarning = document.getElementById('yt-warning');
        if (platform.name === 'YouTube') {
            if (ytWarning) ytWarning.classList.remove('hidden');
            downloadBtn.disabled = true;
            downloadBtn.style.opacity = '0.5';
            downloadBtn.title = "YouTube non disponible";
        } else {
            if (ytWarning) ytWarning.classList.add('hidden');
            downloadBtn.disabled = false;
            downloadBtn.style.opacity = '1';
            downloadBtn.title = "";
        }
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
                playNotificationSound();
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
                
                playNotificationSound();
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

    // --- TOOLS SECTION LOGIC ---
    
    // Tool mode switching
    const toolModeBtns = document.querySelectorAll('.tool-mode-btn');
    const toolContents = document.querySelectorAll('.tool-content');

    toolModeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            toolModeBtns.forEach(b => b.classList.remove('active'));
            toolContents.forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            const toolId = btn.dataset.tool + '-tool';
            const toolEl = document.getElementById(toolId);
            if (toolEl) toolEl.classList.add('active');
        });
    });

    // Helper function for file drop zones
    const setupDropZone = (dropZoneId, inputId) => {
        const dropZone = document.getElementById(dropZoneId);
        const input = document.getElementById(inputId);
        
        if (!dropZone || !input) return;

        dropZone.addEventListener('click', () => input.click());

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.style.borderColor = 'var(--primary)';
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.style.borderColor = 'rgba(255, 255, 255, 0.3)';
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.style.borderColor = 'rgba(255, 255, 255, 0.3)';
            if (e.dataTransfer.files.length) {
                input.files = e.dataTransfer.files;
                const p = dropZone.querySelector('p');
                p.innerHTML = `<i class="fa-solid fa-check"></i> ${e.dataTransfer.files[0].name}`;
            }
        });

        input.addEventListener('change', () => {
            if (input.files.length) {
                const p = dropZone.querySelector('p');
                p.innerHTML = `<i class="fa-solid fa-check"></i> ${input.files[0].name}`;
            }
        });
    };

    // Setup all drop zones
    setupDropZone('video-drop-zone', 'video-input');
    setupDropZone('bg-drop-zone', 'bg-input');
    setupDropZone('wm-drop-zone', 'wm-input');

    // Video Compression
    const compressBtn = document.getElementById('compress-btn');
    if (compressBtn) {
        compressBtn.addEventListener('click', async () => {
            const videoInput = document.getElementById('video-input');
            const compressionLevel = document.getElementById('compression-level');
            const status = document.getElementById('compress-status');
            
            if (!videoInput.files.length) {
                alert('Veuillez sélectionner une vidéo.');
                return;
            }

            compressBtn.disabled = true;
            compressBtn.innerHTML = '<div class="loader" style="width: 20px; height: 20px; border-width: 2px;"></div> Compression...';
            status.classList.remove('hidden');
            status.innerHTML = '<div class="loader"></div><p>Compression en cours... Cela peut prendre plusieurs minutes.</p>';

            const formData = new FormData();
            formData.append('file', videoInput.files[0]);
            formData.append('quality', compressionLevel.value);

            try {
                const response = await fetch('/api/compress-video', { method: 'POST', body: formData });
                const data = await response.json();

                if (data.success) {
                    playNotificationSound();
                    status.innerHTML = `<i class="fa-solid fa-check" style="color: var(--primary); font-size: 1.5rem;"></i><p>Terminé ! <a href="${data.download_url}" download target="_blank" style="color: var(--text-main); text-decoration: underline;">Télécharger</a></p>`;
                } else {
                    status.innerHTML = `<i class="fa-solid fa-times" style="color: #ff5555;"></i><p>Erreur: ${data.error}</p>`;
                }
            } catch (error) {
                status.innerHTML = `<i class="fa-solid fa-times" style="color: #ff5555;"></i><p>Une erreur est survenue.</p>`;
            } finally {
                compressBtn.disabled = false;
                compressBtn.innerHTML = '<span>Compresser la Vidéo</span><i class="fa-solid fa-compress"></i>';
            }
        });
    }

    // Background Removal
    const removebgBtn = document.getElementById('removebg-btn');
    if (removebgBtn) {
        removebgBtn.addEventListener('click', async () => {
            const bgInput = document.getElementById('bg-input');
            const status = document.getElementById('removebg-status');
            
            if (!bgInput.files.length) {
                alert('Veuillez sélectionner une image.');
                return;
            }

            removebgBtn.disabled = true;
            removebgBtn.innerHTML = '<div class="loader" style="width: 20px; height: 20px; border-width: 2px;"></div> Traitement...';
            status.classList.remove('hidden');
            status.innerHTML = '<div class="loader"></div><p>Suppression du fond en cours...</p>';

            const formData = new FormData();
            formData.append('file', bgInput.files[0]);

            try {
                const response = await fetch('/api/remove-background', { method: 'POST', body: formData });
                const data = await response.json();

                if (data.success) {
                    playNotificationSound();
                    status.innerHTML = `<i class="fa-solid fa-check" style="color: var(--primary); font-size: 1.5rem;"></i><p>Terminé ! <a href="${data.download_url}" download target="_blank" style="color: var(--text-main); text-decoration: underline;">Télécharger</a></p>`;
                } else {
                    status.innerHTML = `<i class="fa-solid fa-times" style="color: #ff5555;"></i><p>Erreur: ${data.error}</p>`;
                }
            } catch (error) {
                status.innerHTML = `<i class="fa-solid fa-times" style="color: #ff5555;"></i><p>Une erreur est survenue.</p>`;
            } finally {
                removebgBtn.disabled = false;
                removebgBtn.innerHTML = '<span>Supprimer le Fond</span><i class="fa-solid fa-eraser"></i>';
            }
        });
    }

    // Watermark Removal
    const removewmBtn = document.getElementById('removewm-btn');
    if (removewmBtn) {
        removewmBtn.addEventListener('click', async () => {
            const wmInput = document.getElementById('wm-input');
            const status = document.getElementById('removewm-status');
            
            if (!wmInput.files.length) {
                alert('Veuillez sélectionner une image.');
                return;
            }

            removewmBtn.disabled = true;
            removewmBtn.innerHTML = '<div class="loader" style="width: 20px; height: 20px; border-width: 2px;"></div> Traitement...';
            status.classList.remove('hidden');
            status.innerHTML = '<div class="loader"></div><p>Suppression du watermark...</p>';

            const formData = new FormData();
            formData.append('file', wmInput.files[0]);
            formData.append('x', document.getElementById('wm-x').value);
            formData.append('y', document.getElementById('wm-y').value);
            formData.append('width', document.getElementById('wm-width').value);
            formData.append('height', document.getElementById('wm-height').value);

            try {
                const response = await fetch('/api/remove-watermark', { method: 'POST', body: formData });
                const data = await response.json();

                if (data.success) {
                    playNotificationSound();
                    status.innerHTML = `<i class="fa-solid fa-check" style="color: var(--primary); font-size: 1.5rem;"></i><p>Terminé ! <a href="${data.download_url}" download target="_blank" style="color: var(--text-main); text-decoration: underline;">Télécharger</a></p>`;
                } else {
                    status.innerHTML = `<i class="fa-solid fa-times" style="color: #ff5555;"></i><p>Erreur: ${data.error}</p>`;
                }
            } catch (error) {
                status.innerHTML = `<i class="fa-solid fa-times" style="color: #ff5555;"></i><p>Une erreur est survenue.</p>`;
            } finally {
                removewmBtn.disabled = false;
                removewmBtn.innerHTML = '<span>Supprimer le Watermark</span><i class="fa-solid fa-droplet-slash"></i>';
            }
        });
    }

    // --- SNOWFLAKES ANIMATION (Christmas Theme) ---
    const createSnowflakes = () => {
        const snowflakesContainer = document.getElementById('snowflakes');
        if (!snowflakesContainer) return;
        
        const snowflakeSymbols = ['❄', '❅', '❆', '✻', '✼', '❉'];
        const numberOfSnowflakes = 50;

        for (let i = 0; i < numberOfSnowflakes; i++) {
            const snowflake = document.createElement('div');
            snowflake.classList.add('snowflake');
            snowflake.textContent = snowflakeSymbols[Math.floor(Math.random() * snowflakeSymbols.length)];
            snowflake.style.left = Math.random() * 100 + 'vw';
            snowflake.style.animationDuration = (Math.random() * 3 + 5) + 's';
            snowflake.style.animationDelay = Math.random() * 5 + 's';
            snowflake.style.fontSize = (Math.random() * 15 + 10) + 'px';
            snowflakesContainer.appendChild(snowflake);
        }
    };

    // Initialize snowflakes if Christmas theme
    const initTheme = () => {
        const savedTheme = localStorage.getItem('theme') || 'christmas';
        document.documentElement.setAttribute('data-theme', savedTheme);
        if (themeSelect) themeSelect.value = savedTheme;
        
        // Show/hide snowflakes based on theme
        const snowflakesContainer = document.getElementById('snowflakes');
        if (snowflakesContainer) {
            if (savedTheme === 'christmas') {
                snowflakesContainer.style.display = 'block';
            } else {
                snowflakesContainer.style.display = 'none';
            }
        }
    };

    // Create snowflakes on load
    createSnowflakes();
    initTheme();

    // Update theme change handler to toggle snowflakes
    if (themeSelect) {
        themeSelect.addEventListener('change', (e) => {
            const theme = e.target.value;
            document.documentElement.setAttribute('data-theme', theme);
            localStorage.setItem('theme', theme);
            
            const snowflakesContainer = document.getElementById('snowflakes');
            if (snowflakesContainer) {
                snowflakesContainer.style.display = theme === 'christmas' ? 'block' : 'none';
            }
        });
    }

    // --- BUREAUTIQUE SECTION ---
    const toolModal = document.getElementById('tool-modal');
    const toolContentArea = document.getElementById('tool-content-area');
    const closeToolBtn = document.getElementById('close-tool-btn');
    const toolTitle = document.getElementById('tool-title');
    const bureautiqueItems = document.querySelectorAll('.bureautique-item');

    // Tool config
    const toolConfig = {
        'pdf-to-images': { title: 'PDF en Images', templateId: 'tpl-pdf-to-images', endpoint: '/api/pdf-to-images' },
        'merge-pdf': { title: 'Fusionner PDF', templateId: 'tpl-merge-pdf', endpoint: '/api/merge-pdf' },
        'extract-pages': { title: 'Extraire Pages', templateId: 'tpl-extract-pages', endpoint: '/api/extract-pages' },
        'compress-pdf': { title: 'Compresser PDF', templateId: 'tpl-compress-pdf', endpoint: '/api/compress-pdf' },
        'lock-pdf': { title: 'Verrouiller PDF', templateId: 'tpl-lock-pdf', endpoint: '/api/lock-pdf' },
        'pdf-to-word': { title: 'PDF en Word', templateId: 'tpl-pdf-to-word', endpoint: '/api/pdf-to-word' },
        'add-watermark': { title: 'Ajouter Filigrane', templateId: 'tpl-add-watermark', endpoint: '/api/add-watermark' },
        'add-signature': { title: 'Ajouter Signature', templateId: 'tpl-add-signature', endpoint: '/api/add-signature' },
        'edit-pdf': { title: 'Éditer PDF', templateId: 'tpl-edit-pdf', endpoint: '/api/edit-pdf' },
        // Phase 2 Tools
        'img-to-pdf': { title: 'Image vers PDF', templateId: 'tpl-img-to-pdf', endpoint: '/api/img-to-pdf' },
        'word-to-pdf': { title: 'Word vers PDF', templateId: 'tpl-word-to-pdf', endpoint: '/api/word-to-pdf' },
        'ppt-to-pdf': { title: 'PPT vers PDF', templateId: 'tpl-ppt-to-pdf', endpoint: '/api/ppt-to-pdf' },
        'unlock-pdf': { title: 'Déverrouiller PDF', templateId: 'tpl-unlock-pdf', endpoint: '/api/unlock-pdf' },
        'draw-pdf': { title: 'Dessiner sur PDF', templateId: 'tpl-draw-pdf', endpoint: '/api/draw-pdf' }
    };

    // Open Modal
    bureautiqueItems.forEach(item => {
        item.addEventListener('click', () => {
            const toolKey = item.dataset.tool;
            const config = toolConfig[toolKey];
            if (!config) return;

            toolTitle.textContent = config.title;
            const template = document.getElementById(config.templateId);
            toolContentArea.innerHTML = template.innerHTML;
            
            toolModal.classList.add('active');
            initToolLogic(toolKey, config);
        });
    });

    // Close Modal
    if (closeToolBtn) {
        closeToolBtn.addEventListener('click', () => {
            toolModal.classList.remove('active');
        });
    }

    // Initialize logic for specific tool
    const initToolLogic = (toolKey, config) => {
        const dropZone = toolContentArea.querySelector('.drop-zone');
        const fileInput = toolContentArea.querySelector('input[type="file"]');
        const processBtn = toolContentArea.querySelector('.process-btn');
        const statusArea = toolContentArea.querySelector('.status-area');
        let selectedFiles = [];

        // Drag and Drop
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, preventDefaults, false);
        });

        function preventDefaults(e) {
            e.preventDefault();
            e.stopPropagation();
        }

        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.add('drag-active'), false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.remove('drag-active'), false);
        });

        dropZone.addEventListener('drop', handleDrop, false);
        dropZone.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

        function handleDrop(e) {
            const dt = e.dataTransfer;
            const files = dt.files;
            handleFiles(files);
        }

        function handleFiles(files) {
            if (toolKey === 'merge-pdf') {
                selectedFiles = [...selectedFiles, ...files];
                updateFileList(selectedFiles);
            } else {
                selectedFiles = [files[0]];
                dropZone.querySelector('p').textContent = files[0].name;
                dropZone.classList.add('has-file');
            }
        }

        function updateFileList(files) {
            const fileList = toolContentArea.querySelector('.file-list');
            if (fileList) {
                fileList.innerHTML = Array.from(files).map(f => `<div class="file-item"><i class="fa-solid fa-file-pdf"></i> ${f.name}</div>`).join('');
                if (files.length > 0) processBtn.disabled = false;
            }
        }

        // Specific Logic for Signature/Draw (Two Inputs)
        if (toolKey === 'add-signature' || toolKey === 'draw-pdf') {
            const sigDrop = toolContentArea.querySelector('.sig-drop');
            const sigInput = toolContentArea.querySelector('.sig-input');
            
            sigDrop.addEventListener('click', () => sigInput.click());
            sigInput.addEventListener('change', (e) => {
                if (e.target.files[0]) {
                    sigDrop.querySelector('p').textContent = e.target.files[0].name;
                    sigDrop.classList.add('has-file');
                }
            });
        }

        // Process Action
        processBtn.addEventListener('click', async () => {
            if (selectedFiles.length === 0) {
                showStatus(statusArea, 'Veuillez sélectionner un fichier', 'error');
                return;
            }

            const formData = new FormData();
            
            if (toolKey === 'merge-pdf') {
                selectedFiles.forEach(file => formData.append('files[]', file));
            } else {
                formData.append('file', selectedFiles[0]);
            }

            // Add extra parameters
            const inputs = toolContentArea.querySelectorAll('input:not([type="file"])');
            inputs.forEach(input => {
                if (input.className.includes('page-range')) formData.append('pages', input.value);
                if (input.className.includes('password')) formData.append('password', input.value);
                if (input.className.includes('watermark')) formData.append('text', input.value);
                if (input.className.includes('page-num')) formData.append('page', input.value);
                if (input.className.includes('pos-x')) formData.append('x', input.value);
                if (input.className.includes('pos-y')) formData.append('y', input.value);
                if (input.className.includes('annot-text')) formData.append('text', input.value);
                if (input.className.includes('color-rgb')) formData.append('color', input.value);
            });

            // Special case for signature/draw file
            if (toolKey === 'add-signature' || toolKey === 'draw-pdf') {
                const sigInput = toolContentArea.querySelector('.sig-input');
                if (sigInput.files[0]) {
                    formData.append('signature', sigInput.files[0]);
                } else {
                    showStatus(statusArea, 'Veuillez ajouter une image/signature', 'error');
                    return;
                }
            }

            processBtn.disabled = true;
            processBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Traitement...';
            statusArea.classList.add('hidden');

            try {
                const response = await fetch(config.endpoint, {
                    method: 'POST',
                    body: formData
                });

                const data = await response.json();

                if (data.success) {
                    playNotificationSound();
                    let msg = `Succès ! <a href="${data.download_url}" class="download-link text-primary underline" download>Télécharger le fichier</a>`;
                    if (data.storage_path) {
                        msg += `<div class="mt-2 text-xs text-text-muted bg-glass/5 p-2 rounded">Sauvegardé ici: <br><span class="font-mono select-all">${data.storage_path}</span></div>`;
                    }
                    showStatus(statusArea, msg, 'success');
                } else {
                    showStatus(statusArea, `Erreur: ${data.error}`, 'error');
                }
            } catch (error) {
                showStatus(statusArea, `Erreur de connexion: ${error.message}`, 'error');
            } finally {
                processBtn.disabled = false;
                processBtn.innerHTML = `<span>${config.title}</span> <i class="fa-solid fa-check"></i>`;
            }
        });
    };

    function showStatus(element, message, type) {
        element.innerHTML = message;
        element.className = `status-area ${type}`;
        element.classList.remove('hidden');
    }
});
