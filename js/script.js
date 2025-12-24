document.addEventListener('DOMContentLoaded', () => {
    // --- GESTION DU THÈME ---
    const themeSelect = document.getElementById('theme-select');
    const savedTheme = localStorage.getItem('gemini3-theme') || 'cyber';
    
    // Appliquer le thème sauvegardé immédiatement
    document.documentElement.setAttribute('data-theme', savedTheme);
    if(themeSelect) themeSelect.value = savedTheme;

    if(themeSelect) {
        themeSelect.addEventListener('change', (e) => {
            const theme = e.target.value;
            document.documentElement.setAttribute('data-theme', theme);
            localStorage.setItem('gemini3-theme', theme);
        });

    }

    const speak = (text) => {
        try {
            const u = new SpeechSynthesisUtterance(text);
            const voices = window.speechSynthesis.getVoices();
            const fr = voices.find(v => v.lang && v.lang.toLowerCase().startsWith('fr'));
            if (fr) u.voice = fr;
            u.lang = 'fr-FR';
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(u);
        } catch (e) {}
    };
    window.accessibilityAnnounce = (text) => {
        if (document.body.classList.contains('accessibility-visual')) speak(text);
    };
    const overlay = document.getElementById('accessibility-overlay');
    const leftBtn = document.getElementById('acc-left-btn');
    const rightBtn = document.getElementById('acc-right-btn');
    const accEnableBtn = document.getElementById('acc-enable-btn');
    const accDisableBtn = document.getElementById('acc-disable-btn');
    const showOverlay = () => {
        if (!overlay) return;
        overlay.classList.remove('hidden');
        overlay.classList.add('active');
        setTimeout(() => { if (leftBtn) leftBtn.focus(); }, 50);
        speak("Bienvenue. Appuyez ou cliquez à gauche si vous n’avez pas de handicap visuel. Appuyez ou cliquez à droite si vous êtes en situation de handicap visuel.");
    };
    const applyMode = (mode) => {
        if (mode === 'visual') {
            document.body.classList.add('accessibility-visual');
            window.accessibilityAnnounce('Mode accessibilité visuelle activé');
        } else {
            document.body.classList.remove('accessibility-visual');
        }
        if (accEnableBtn && accDisableBtn) {
            if (mode === 'visual') { accEnableBtn.classList.add('hidden'); accDisableBtn.classList.remove('hidden'); }
            else { accDisableBtn.classList.add('hidden'); accEnableBtn.classList.remove('hidden'); }
        }
    };
    const choose = (mode) => {
        localStorage.setItem('accessibility-choice', mode);
        applyMode(mode);
        if (overlay) { overlay.classList.add('hidden'); overlay.classList.remove('active'); }
    };
    const storedChoice = localStorage.getItem('accessibility-choice');
    if (!storedChoice) {
        showOverlay();
    } else {
        applyMode(storedChoice);
    }
    if (leftBtn) leftBtn.addEventListener('click', () => choose('none'));
    if (rightBtn) rightBtn.addEventListener('click', () => choose('visual'));
    if (accEnableBtn) accEnableBtn.addEventListener('click', () => choose('visual'));
    if (accDisableBtn) accDisableBtn.addEventListener('click', () => choose('none'));
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            const rect = overlay.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const half = rect.width / 2;
            choose(x < half ? 'none' : 'visual');
        });
        overlay.addEventListener('contextmenu', (e) => { e.preventDefault(); choose('visual'); });
        overlay.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') choose('none');
            else if (e.key === 'ArrowRight') choose('visual');
            else if (e.key === 'Enter' || e.key === ' ') {
                const active = document.activeElement === rightBtn ? 'visual' : 'none';
                choose(active);
            }
        });
    }
    const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const trapFocus = (container) => {
        if (!container) return;
        container.addEventListener('keydown', (e) => {
            if (e.key !== 'Tab') return;
            const nodes = Array.from(container.querySelectorAll(focusableSelector)).filter(n => !n.classList.contains('hidden'));
            if (nodes.length === 0) return;
            const first = nodes[0];
            const last = nodes[nodes.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        });
    };
    trapFocus(overlay);

    // --- LOGIQUE DE L'HISTORIQUE ---
    const loadHistory = async () => {
        const historyBody = document.getElementById('history-body');
        if (!historyBody) return;
        
        historyBody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px;">Chargement...</td></tr>';
        
        try {
            const response = await fetch('/api/history');
            const data = await response.json();
            
            historyBody.innerHTML = '';
            
            if (data.length === 0) {
                historyBody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px;">Aucun historique récent.</td></tr>';
                return;
            }
            
            data.forEach(item => {
                const row = document.createElement('tr');
                row.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
                row.innerHTML = `
                    <td style="padding: 10px;">${item.timestamp}</td>
                    <td style="padding: 10px;">${item.action}</td>
                    <td style="padding: 10px;">${item.filename}</td>
                    <td style="padding: 10px;"><span style="color: ${item.status === 'success' ? '#4ade80' : '#f87171'}">${item.status}</span></td>
                `;
                historyBody.appendChild(row);
            });
        } catch (error) {
            console.error('Error loading history:', error);
            historyBody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px; color: #f87171;">Erreur de chargement.</td></tr>';
        }
    };

    // --- EFFET MACHINE À ÉCRIRE ---
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
            
            // Réinitialiser pour retaper (optionnel, supprimer si une seule fois suffit)
            if (h1) { h1.dataset.typed = ""; h1.innerText = h1.getAttribute('data-original-text') || h1.innerText; h1.setAttribute('data-original-text', h1.innerText); }
            if (p) { p.dataset.typed = ""; p.innerText = p.getAttribute('data-original-text') || p.innerText; p.setAttribute('data-original-text', p.innerText); }

            // Démarrer l'effet de frappe au changement d'onglet
            initTypingEffect();
            window.accessibilityAnnounce(`Section ${btn.innerText}`);
        });
    });

    // Global function for Landing Page cards
    window.switchTab = (tabId) => {
        const btn = document.querySelector(`.nav-btn[data-tab="${tabId}"]`);
        if (btn) btn.click();
    };

    // Converter logic moved to line 500+

    // --- MOBILE MENU LOGIC ---
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const navLinks = document.getElementById('nav-links');

    if (mobileMenuBtn && navLinks) {
        mobileMenuBtn.addEventListener('click', () => {
            navLinks.classList.toggle('mobile-active');
            // Toggle icon
            const icon = mobileMenuBtn.querySelector('i');
            if (navLinks.classList.contains('mobile-active')) {
                icon.classList.remove('fa-bars');
                icon.classList.add('fa-times');
            } else {
                icon.classList.remove('fa-times');
                icon.classList.add('fa-bars');
            }
        });

        // Close menu when clicking a link
        navLinks.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                navLinks.classList.remove('mobile-active');
                const icon = mobileMenuBtn.querySelector('i');
                if (icon) {
                    icon.classList.remove('fa-times');
                    icon.classList.add('fa-bars');
                }
            });
        });
    }

    // --- DOWNLOAD LOGIC ---
    const downloadBtn = document.getElementById('download-btn');
    const downloadStatus = document.getElementById('download-status');
    const urlInput = document.getElementById('url-input');
    const clearBtn = document.getElementById('clear-btn');
    const qualitySelect = document.getElementById('quality-select');
    const platformBadge = document.getElementById('platform-badge');

    // Détection de la Plateforme
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

    const waDrop = document.getElementById('wa-status-drop');
    const waInput = document.getElementById('wa-status-input');
    const waList = document.getElementById('wa-files-list');
    const waZipBtn = document.getElementById('wa-zip-btn');
    const waStatus = document.getElementById('wa-status-area');
    let waFiles = [];
    if (waDrop && waInput && waZipBtn) {
        const renderWaList = () => {
            waList.innerHTML = '';
            waFiles.forEach((f, i) => {
                const chip = document.createElement('div');
                chip.style.padding = '6px 10px';
                chip.style.background = 'var(--glass-bg)';
                chip.style.border = '1px solid var(--glass-border)';
                chip.style.borderRadius = '10px';
                chip.style.color = 'var(--text-main)';
                chip.textContent = f.name || `Statut ${i+1}`;
                waList.appendChild(chip);
            });
        };
        waDrop.addEventListener('click', () => waInput.click());
        waDrop.addEventListener('dragover', (e) => { e.preventDefault(); waDrop.style.borderColor = 'var(--primary)'; });
        waDrop.addEventListener('dragleave', () => { waDrop.style.borderColor = 'var(--glass-border)'; });
        waDrop.addEventListener('drop', (e) => {
            e.preventDefault();
            const files = Array.from(e.dataTransfer.files || []);
            waFiles = files;
            renderWaList();
            waDrop.querySelector('p').textContent = `${files.length} fichier(s) sélectionné(s)`;
            waDrop.style.borderColor = 'var(--primary)';
        });
        waInput.addEventListener('change', (e) => {
            const files = Array.from(e.target.files || []);
            waFiles = files;
            renderWaList();
            waDrop.querySelector('p').textContent = `${files.length} fichier(s) sélectionné(s)`;
            waDrop.style.borderColor = 'var(--primary)';
        });
        waZipBtn.addEventListener('click', async () => {
            if (!waFiles.length) { showStatus(waStatus, 'Veuillez choisir des statuts.', 'error'); return; }
            waZipBtn.disabled = true;
            const originalHtml = waZipBtn.innerHTML;
            waZipBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Préparation...';
            waStatus.classList.remove('hidden');
            waStatus.innerHTML = '<div class="loader"></div><p>Compression en cours...</p>';
            const fd = new FormData();
            waFiles.forEach(f => fd.append('files[]', f, f.name));
            try {
                const res = await fetch('/api/whatsapp-status-zip', { method: 'POST', body: fd });
                const data = await res.json();
                if (data.task_id) {
                    pollToolStatus(data.task_id, waStatus, waZipBtn, originalHtml);
                } else if (data.download_url) {
                    waZipBtn.disabled = false;
                    waZipBtn.innerHTML = originalHtml;
                    waStatus.innerHTML = `<i class="fa-solid fa-check" style="color: var(--primary);"></i><p>Prêt: <a href="${data.download_url}" download target="_blank">Télécharger</a></p>`;
                } else {
                    throw new Error(data.error || 'Réponse inattendue');
                }
            } catch (err) {
                waZipBtn.disabled = false;
                waZipBtn.innerHTML = originalHtml;
                showStatus(waStatus, `Erreur: ${err.message}`, 'error');
            }
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
                    console.log("URL détectée, collée mais pas de téléchargement auto.");
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
    
    // Demander la permission au chargement
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
    
    // Reset UI
    if (urlInput) urlInput.value = '';
    if (clearBtn) clearBtn.classList.add('hidden');
    if (platformBadge) updatePlatformBadge(''); // Reset badge
    
    if (downloadStatus) {
        // We wait a bit before hiding it to let user see "Finished" if valid
        // But for reset, we might want to just hide it or reset content
        // The user asked to "Hide bar" at end.
        
        // Reset bar width
        const progressBar = document.getElementById('progress-bar');
        const progressText = document.getElementById('progress-text');
        if (progressBar) progressBar.style.width = '0%';
        if (progressText) progressText.innerText = '0%';
        
        // Hide container
        downloadStatus.classList.add('hidden');
    }

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

const pollToolStatus = (taskId, statusElement, buttonElement, originalButtonHtml) => {
    let toolPollInterval = setInterval(async () => {
        try {
            const response = await fetch(`/api/download/status/${taskId}`);
            const data = await response.json();

            if (data.status === 'processing' || data.status === 'pending' || data.status === 'downloading') {
                const progress = data.progress || 0;
                statusElement.classList.remove('hidden');
                statusElement.innerHTML = `
                    <div class="loader"></div>
                    <p>Traitement en cours... ${Math.round(progress)}%</p>
                    <div style="width: 100%; background: rgba(255,255,255,0.1); height: 4px; border-radius: 2px; margin-top: 5px;">
                        <div style="width: ${progress}%; background: var(--primary); height: 100%; border-radius: 2px; transition: width 0.3s;"></div>
                    </div>
                    <button class="cancel-tool-btn" style="margin-top: 10px; padding: 8px 16px; background: var(--secondary); border: none; border-radius: 8px; color: white; cursor: pointer;">
                        <i class="fa-solid fa-xmark"></i> Annuler
                    </button>
                `;
                
                // Attach cancel handler
                const cancelBtn = statusElement.querySelector('.cancel-tool-btn');
                if (cancelBtn && !cancelBtn.hasAttribute('data-listener')) {
                    cancelBtn.setAttribute('data-listener', 'true');
                    cancelBtn.addEventListener('click', async () => {
                        try {
                            await fetch(`/api/download/cancel/${taskId}`, { method: 'POST' });
                            statusElement.innerHTML = `<p style="color: var(--secondary);"><i class="fa-solid fa-spinner fa-spin"></i> Annulation en cours...</p>`;
                        } catch (e) {
                            console.error('Cancel error:', e);
                        }
                    });
                }
            } else if (data.status === 'completed') {
                clearInterval(toolPollInterval);
                buttonElement.disabled = false;
                buttonElement.innerHTML = originalButtonHtml;
                statusElement.innerHTML = `
                    <i class="fa-solid fa-check" style="color: var(--primary); font-size: 1.5rem;"></i>
                    <p>Terminé ! <a href="${data.result.download_url}" download target="_blank" style="color: var(--text-main); text-decoration: underline;">Télécharger</a></p>
                `;
                
                // Optional: show success modal like download?
            } else if (data.status === 'error') {
                clearInterval(toolPollInterval);
                buttonElement.disabled = false;
                buttonElement.innerHTML = originalButtonHtml;
                statusElement.innerHTML = `<i class="fa-solid fa-times" style="color: #ff5555;"></i><p>Erreur: ${data.error}</p>`;
            } else if (data.status === 'cancelled') {
                clearInterval(toolPollInterval);
                buttonElement.disabled = false;
                buttonElement.innerHTML = originalButtonHtml;
                statusElement.innerHTML = `<p style="color: var(--secondary);"><i class="fa-solid fa-ban"></i> Action annulée.</p>`;
            }
        } catch (err) {
            console.error('Tool Polling Error:', err);
            // Don't clear interval on transient fetch errors
        }
    }, 2000);
};

    // --- CONVERT LOGIC ---
    const convertBtn = document.getElementById('convert-btn');
    const convertStatus = document.createElement('div');
    convertStatus.className = 'status-area hidden';
    convertBtn.parentNode.appendChild(convertStatus);

    // Voice Lock Logic
    const voiceSelect = document.getElementById('voice-select');
    const updateVoiceLock = () => {
        const activeMode = document.querySelector('.mode-btn.active').dataset.mode;
        if (voiceSelect) {
            if (activeMode === 'text-audio') {
                voiceSelect.disabled = false;
                voiceSelect.parentElement.style.opacity = '1';
                voiceSelect.title = '';
            } else {
                voiceSelect.disabled = true;
                voiceSelect.parentElement.style.opacity = '0.5';
                voiceSelect.title = 'Disponible uniquement en mode Texte vers Audio';
            }
        }
    };

    // Mode Switchers
    const modeBtns = document.querySelectorAll('.mode-btn');
    modeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            modeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Show relevant content
            const mode = btn.dataset.mode;
            document.querySelectorAll('.mode-content').forEach(el => el.classList.remove('active'));
            document.getElementById(`${mode}-mode`).classList.add('active');
            
            // Update Voice Lock
            updateVoiceLock();
        });
    });
    
    // Initial Lock Check
    updateVoiceLock();

    convertBtn.addEventListener('click', async () => {
        const activeMode = document.querySelector('.mode-btn.active').dataset.mode;
        const originalHtml = convertBtn.innerHTML;
        
        try {
            let endpoint = '';
            let body = null;
            let headers = {};

            if (activeMode === 'video-audio') {
                const fileInput = document.getElementById('file-input');
                if (fileInput.files.length === 0) throw new Error('Veuillez sélectionner une vidéo.');
                endpoint = '/api/convert-video';
                const formData = new FormData();
                formData.append('file', fileInput.files[0]);
                body = formData;
            } else {
                const textInput = document.getElementById('text-input');
                const voiceSelect = document.getElementById('voice-select');
                if (!textInput.value) throw new Error('Veuillez entrer du texte.');
                endpoint = '/api/convert-text';
                body = JSON.stringify({ text: textInput.value, voice: voiceSelect.value });
                headers = { 'Content-Type': 'application/json' };
            }

            convertBtn.disabled = true;
            convertBtn.innerHTML = '<div class="loader" style="width: 20px; height: 20px; border-width: 2px;"></div> Initiation...';
            convertStatus.classList.remove('hidden');
            convertStatus.innerHTML = '<div class="loader"></div><p>Connexion au serveur...</p>';

            const response = await fetch(endpoint, { method: 'POST', headers: headers, body: body });
            const data = await response.json();

            if (!response.ok) throw new Error(data.error || 'Erreur serveur');

            if (data.task_id) {
                // Async Task
                pollToolStatus(data.task_id, convertStatus, convertBtn, originalHtml);
            } else if (data.success) {
                // Direct Response (like text-to-speech potentially)
                convertBtn.disabled = false;
                convertBtn.innerHTML = originalHtml;
                convertStatus.innerHTML = `<i class="fa-solid fa-check" style="color: var(--primary);"></i><p>Prêt ! <a href="${data.download_url}" download>Télécharger</a></p>`;
                
                const link = document.createElement('a');
                link.href = data.download_url;
                link.download = data.filename;
                link.click();
            }

        } catch (error) {
            convertBtn.disabled = false;
            convertBtn.innerHTML = originalHtml;
            convertStatus.innerHTML = `<p style="color: #ff5555;">Erreur: ${error.message}</p>`;
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

    // Configuration de toutes les zones de dépôt
    setupDropZone('video-drop-zone', 'video-input');
    setupDropZone('bg-drop-zone', 'bg-input');
    setupDropZone('wm-drop-zone', 'wm-input');

    // Old tools removed.

    // --- ANIMATION FLOCONS (Thème Noël) ---
    // --- ANIMATION NEIGE SIMPLE ---
    const createSimpleSnow = () => {
        const container = document.getElementById('simple-snow-container');
        if (!container) return;
        
        container.innerHTML = '';
        container.classList.remove('hidden');
        const count = 50;
        
        for(let i=0; i<count; i++) {
            const dot = document.createElement('div');
            dot.classList.add('snow-dot');
            const size = Math.random() * 3 + 2; // 2-5px
            dot.style.width = `${size}px`;
            dot.style.height = `${size}px`;
            dot.style.left = `${Math.random() * 100}vw`;
            dot.style.top = `-${Math.random() * 20}px`;
            dot.style.animationDuration = `${Math.random() * 5 + 5}s`; // 5-10s
            dot.style.animationDelay = `${Math.random() * 5}s`;
            dot.style.opacity = Math.random();
            container.appendChild(dot);
        }
    };

    // Gestion du thème pour la neige
    const initTheme = () => {
        const savedTheme = localStorage.getItem('gemini3-theme') || 'cyber';
        const container = document.getElementById('simple-snow-container');
        
        if (savedTheme === 'christmas') {
            if(container) {
                container.style.display = 'block';
                if(container.children.length === 0) createSimpleSnow();
            }
        } else {
            if(container) container.style.display = 'none';
        }
    };

    initTheme();

    if (themeSelect) {
        themeSelect.addEventListener('change', (e) => {
            const theme = e.target.value;
            const container = document.getElementById('simple-snow-container');
            if (theme === 'christmas') {
                container.style.display = 'block';
                createSimpleSnow();
            } else {
                container.style.display = 'none';
            }
        });
    }

    // --- SECTION BUREAUTIQUE ---
    const toolModal = document.getElementById('tool-modal');
    const toolContentArea = document.getElementById('tool-content-area');
    const closeToolBtn = document.getElementById('close-tool-btn');
    const toolTitle = document.getElementById('tool-title');
    const bureautiqueItems = document.querySelectorAll('.bureautique-item');

    // Configuration des outils
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
        // NEW TOOLS
        'img-to-pdf': { title: 'Image vers PDF', templateId: 'tpl-img-to-pdf', endpoint: '/api/img-to-pdf' },
        'word-to-pdf': { title: 'Word vers PDF', templateId: 'tpl-word-to-pdf', endpoint: '/api/word-to-pdf' },
        'ppt-to-pdf': { title: 'PowerPoint vers PDF', templateId: 'tpl-ppt-to-pdf', endpoint: '/api/ppt-to-pdf' },
        'unlock-pdf': { title: 'Déverrouiller PDF', templateId: 'tpl-unlock-pdf', endpoint: '/api/unlock-pdf' },
        'draw-pdf': { title: 'Dessiner sur PDF', templateId: 'tpl-add-drawing', endpoint: '/api/draw-pdf' }
    };

    // Ouverture Modale
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

    // Fermeture Modale
    if (closeToolBtn) {
        closeToolBtn.addEventListener('click', () => {
            toolModal.classList.remove('active');
        });
    }

    // Initialiser la logique spécifique à l'outil
    const initToolLogic = (toolKey, config) => {
        if (toolKey === 'add-signature') {
            setupSignatureTool(config);
            return;
        }
        if (toolKey === 'add-watermark') {
            setupWatermarkTool(config);
            return;
        }
        if (toolKey === 'draw-pdf') {
            setupDrawingTool(config);
            return;
        }
        // Éditeur Visuel spécial pour 'edit-pdf'
        if (toolKey === 'edit-pdf') {
            setupVisualEditor(config);
            return;
        }

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

        // Logique spécifique pour Signature/Dessin (Deux entrées)
        if (toolKey === 'add-signature' || toolKey === 'draw-pdf') {
            const sigDrop = toolContentArea.querySelector('.sig-drop') || toolContentArea.querySelector('.sig-input-wrapper');
            const sigInput = toolContentArea.querySelector('.sig-input');
            
            if (sigDrop && sigInput) {
                sigDrop.addEventListener('click', () => sigInput.click());
                sigInput.addEventListener('change', (e) => {
                    if (e.target.files[0]) {
                        // For draw-pdf, finding p might be different structure, handle safely
                        const p = sigDrop.querySelector('p');
                        if (p) p.textContent = e.target.files[0].name;
                        sigDrop.classList.add('has-file');
                    }
                });
            }
        }

        // Action de Traitement
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

            // Ajouter les paramètres supplémentaires
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

            // Cas spécial pour fichier signature/dessin
            if (toolKey === 'add-signature' || toolKey === 'draw-pdf') {
                const sigInput = toolContentArea.querySelector('.sig-input');
                if (sigInput && sigInput.files[0]) {
                    formData.append('signature', sigInput.files[0]);
                } else {
                    showStatus(statusArea, 'Veuillez ajouter une image/signature', 'error');
                    return;
                }
            }

            const originalButtonHtml = processBtn.innerHTML;
            processBtn.disabled = true;
            // Afficher "Téléchargement..." en premier car la requête inclut l'upload
            processBtn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up fa-bounce"></i> Téléchargement...';
            statusArea.classList.add('hidden');

            try {
                const response = await fetch(config.endpoint, {
                    method: 'POST',
                    body: formData
                });

                const data = await response.json();

                if (!response.ok) throw new Error(data.error || 'Erreur serveur');

                if (data.task_id) {
                    showStatus(statusArea, '<div class="loader"></div><p>Action mise en file d\'attente...</p>', 'info');
                    pollToolStatus(data.task_id, statusArea, processBtn, originalButtonHtml);
                } else if (data.success) {
                    let msg = `Succès ! <a href="${data.download_url}" class="download-link" download>Télécharger le fichier</a>`;
                    if (data.storage_path) {
                        msg += `<br><span style="font-size:0.8em; color:var(--text-muted);">Enregistré sous : ${data.storage_path}</span>`;
                    }
                    showStatus(statusArea, msg, 'success');
                    processBtn.disabled = false;
                    processBtn.innerHTML = originalButtonHtml;
                } else {
                    throw new Error(data.error || 'Erreur inconnue');
                }
            } catch (error) {
                showStatus(statusArea, `Erreur: ${error.message}`, 'error');
                processBtn.disabled = false;
                processBtn.innerHTML = originalButtonHtml;
            }
        });
    };

    function showStatus(element, message, type) {
        element.innerHTML = message;
        element.className = `status-area ${type}`;
        element.classList.remove('hidden');
    }

    // --- LOGIQUE ÉDITEUR VISUEL PDF ---
    function setupVisualEditor(config) {
        const ui = toolContentArea.querySelector('#visual-editor-ui');
        const dropZone = toolContentArea.querySelector('#visual-pdf-drop');
        const fileInput = toolContentArea.querySelector('#visual-pdf-input');
        const canvas = toolContentArea.querySelector('#the-canvas');
        const ctx = canvas.getContext('2d');
        const canvasContainer = toolContentArea.querySelector('#canvas-container');
        const addTextBtn = toolContentArea.querySelector('#add-text-tool');
        const saveBtn = toolContentArea.querySelector('#save-visual-pdf');
        const statusArea = toolContentArea.querySelector('.status-area');
        const btnPrev = toolContentArea.querySelector('#edit-prev-page');
        const btnNext = toolContentArea.querySelector('#edit-next-page');
        const pageSpan = toolContentArea.querySelector('#edit-page-num');
        const totalSpan = toolContentArea.querySelector('#edit-total-pages');
        const pageSelect = toolContentArea.querySelector('#edit-page-select');
        
        let currentPdf = null;
        let pdfFile = null;
        let activeTextElement = null;
        let scale = 1.0;
        let pageNum = 1;
        let renderTask = null;

        // Réinitialiser UI
        ui.classList.add('hidden');
        dropZone.classList.remove('hidden');
        dropZone.querySelector('p').textContent = 'Glissez votre PDF à éditer';
        
        // Gestion Sélection Fichier
        dropZone.onclick = () => fileInput.click();
        fileInput.onchange = async (e) => {
            if (e.target.files[0]) {
                const file = e.target.files[0];
                if (file.type !== 'application/pdf') {
                    alert('Ce n\'est pas un PDF !');
                    return;
                }
                pdfFile = file;
                dropZone.classList.add('hidden');
                ui.classList.remove('hidden');
                statusArea.classList.add('hidden');
                
                // Rendu PDF
                const arrayBuffer = await file.arrayBuffer();
                const loadingTask = pdfjsLib.getDocument(arrayBuffer);
                currentPdf = await loadingTask.promise;
                pageNum = 1;
                if (totalSpan) totalSpan.textContent = currentPdf.numPages;
                if (pageSpan) pageSpan.textContent = pageNum;
                if (pageSelect) {
                    pageSelect.innerHTML = '';
                    for (let i = 1; i <= currentPdf.numPages; i++) {
                        const opt = document.createElement('option');
                        opt.value = i;
                        opt.textContent = i;
                        pageSelect.appendChild(opt);
                    }
                    pageSelect.value = '1';
                }
                await renderPage(pageNum);
            }
        };

        const renderPage = async (num) => {
            if (!currentPdf) return;
            if (renderTask && typeof renderTask.cancel === 'function') {
                try { renderTask.cancel(); } catch (_) {}
            }
            if (pageSpan) pageSpan.textContent = num;
            const page = await currentPdf.getPage(num);
            const viewport = page.getViewport({ scale: 1 });
            const containerWidth = (canvasContainer && canvasContainer.clientWidth ? canvasContainer.clientWidth : (toolContentArea.clientWidth - 40));
            scale = containerWidth < viewport.width ? (containerWidth / viewport.width) : 1.0;
            const scaledViewport = page.getViewport({ scale });
            canvas.height = scaledViewport.height;
            canvas.width = scaledViewport.width;
            const context = { canvasContext: ctx, viewport: scaledViewport };
            try {
                renderTask = page.render(context);
                await renderTask.promise;
            } catch (err) {
                if (err && err.name === 'RenderingCancelledException') return;
                console.error(err);
            }
        };

        if (btnPrev) btnPrev.addEventListener('click', async () => {
            if (!currentPdf) return;
            if (pageNum <= 1) return;
            pageNum -= 1;
            if (pageSelect) pageSelect.value = String(pageNum);
            await renderPage(pageNum);
            window.accessibilityAnnounce(`Page ${pageNum}`);
        });
        
        if (btnNext) btnNext.addEventListener('click', async () => {
            if (!currentPdf) return;
            if (pageNum >= currentPdf.numPages) return;
            pageNum += 1;
            if (pageSelect) pageSelect.value = String(pageNum);
            await renderPage(pageNum);
            window.accessibilityAnnounce(`Page ${pageNum}`);
        });

        if (pageSelect) pageSelect.addEventListener('change', async (e) => {
            if (!currentPdf) return;
            const val = parseInt(e.target.value, 10);
            if (!isNaN(val) && val >= 1 && val <= currentPdf.numPages) {
                pageNum = val;
                await renderPage(pageNum);
                window.accessibilityAnnounce(`Page ${pageNum}`);
            }
        });

        // Outil Ajouter Texte
        addTextBtn.onclick = () => {
            if (activeTextElement) return; // Only one text for now (backend limitation)
            
            const textEl = document.createElement('div');
            textEl.contentEditable = true;
            textEl.innerText = "Double-cliquez pour éditer";
            textEl.style.position = 'absolute';
            textEl.style.left = '50px';
            textEl.style.top = '50px';
            textEl.style.color = document.getElementById('editor-color').value;
            textEl.style.fontSize = document.getElementById('editor-size').value + 'px';
            textEl.style.fontFamily = 'Arial, sans-serif';
            textEl.style.background = 'rgba(255, 255, 255, 0.5)';
            textEl.style.padding = '5px';
            textEl.style.border = '1px dashed var(--primary)';
            textEl.style.cursor = 'move';
            textEl.style.zIndex = 100;
            
            canvasContainer.appendChild(textEl);
            activeTextElement = textEl;
            
            // Logique de Déplacement (Drag)
            let isDragging = false;
            let startX, startY, initialLeft, initialTop;

            textEl.addEventListener('mousedown', (e) => {
                isDragging = true;
                startX = e.clientX;
                startY = e.clientY;
                initialLeft = textEl.offsetLeft;
                initialTop = textEl.offsetTop;
                textEl.style.cursor = 'grabbing';
            });

            window.addEventListener('mousemove', (e) => {
                if (isDragging) {
                    const dx = e.clientX - startX;
                    const dy = e.clientY - startY;
                    textEl.style.left = `${initialLeft + dx}px`;
                    textEl.style.top = `${initialTop + dy}px`;
                }
            });

            window.addEventListener('mouseup', () => {
                isDragging = false;
                if(textEl) textEl.style.cursor = 'move';
            });
            
            // Mises à jour de style
            document.getElementById('editor-color').onchange = (e) => textEl.style.color = e.target.value;
            document.getElementById('editor-size').onchange = (e) => textEl.style.fontSize = e.target.value + 'px';
        };

        // Action Sauvegarder
        saveBtn.onclick = async () => {
            if (!activeTextElement) {
                alert('Ajoutez du texte d\'abord !');
                return;
            }
            
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Traitement...';
            
            // Calculate normalized coordinates
            // Backend expects Top-Left logic now (based on my update) or I send normalized and it handles it.
            // I updated backend to accept normalized.
            // Normalized X = offsetLeft / canvasWidth
            const normX = activeTextElement.offsetLeft / canvas.width;
            const normY = activeTextElement.offsetTop / canvas.height;
            
            const formData = new FormData();
            formData.append('file', pdfFile);
            formData.append('text', activeTextElement.innerText);
            formData.append('x', normX);
            formData.append('y', normY);
            formData.append('page', pageNum - 1);
            
            // Color conversion hex to r,g,b
            const hex = activeTextElement.style.color || '#000000'; // might be rgb(r, g, b)
            // If it returns rgb string, we pass it directly? Backend parser expects "r,g,b".
            // Browser style.color returns "rgb(0, 0, 0)".
            // Let's regex it
            let colorStr = "0,0,0";
            if (hex.startsWith('rgb')) {
                 const rgb = hex.match(/\d+/g);
                 if (rgb) colorStr = rgb.join(',');
            } else {
                 // Convert hex to rgb
                 // Simplified: backend fails if bad format?
                 // Let's assume input color picker gives hex, but style.color converts to rgb.
                 // We can use the input value directly
                 const inputHex = document.getElementById('editor-color').value;
                 const r = parseInt(inputHex.substr(1,2), 16);
                 const g = parseInt(inputHex.substr(3,2), 16);
                 const b = parseInt(inputHex.substr(5,2), 16);
                 colorStr = `${r},${g},${b}`;
            }
            formData.append('color', colorStr);
            formData.append('fontsize', parseInt(activeTextElement.style.fontSize));
            
            try {
                const response = await fetch('/api/edit-pdf', { method: 'POST', body: formData });
                const data = await response.json();
                
                if (!response.ok) {
                    showStatus(statusArea, `Erreur: ${data.error || 'Erreur serveur'}`, 'error');
                } else if (data.task_id) {
                    statusArea.classList.remove('hidden');
                    statusArea.innerHTML = '<div class="loader"></div><p>Traitement en cours...</p>';
                    pollToolStatus(data.task_id, statusArea, saveBtn, '<i class="fa-solid fa-floppy-disk"></i> Sauvegarder');
                } else if (data.success && data.download_url) {
                    showStatus(statusArea, `Succès ! <a href="${data.download_url}" class="download-link" download>Télécharger le fichier</a>`, 'success');
                } else {
                    showStatus(statusArea, `Erreur: ${data.error || 'Réponse inattendue'}`, 'error');
                }
            } catch (err) {
                 showStatus(statusArea, `Erreur: ${err.message}`, 'error');
            } finally {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Sauvegarder';
            }
        };
    }

    function setupSignatureTool(config) {
        // --- Éléments UI Scopés ---
        // Utiliser toolContentArea à la place du template global
        const dropZone = toolContentArea.querySelector('#sig-pdf-drop');
        const pdfInput = toolContentArea.querySelector('.pdf-input');
        const workspace = toolContentArea.querySelector('#signature-workspace');
        
        // Toolbar
        const toolDraw = toolContentArea.querySelector('#tool-draw');
        const toolImage = toolContentArea.querySelector('#tool-image');
        const toolEraser = toolContentArea.querySelector('#tool-eraser');
        const colorInput = toolContentArea.querySelector('#sig-color');
        const widthInput = toolContentArea.querySelector('#sig-width');
        const btnUndo = toolContentArea.querySelector('#sig-undo');
        const btnClear = toolContentArea.querySelector('#sig-clear');
        const imgUpload = toolContentArea.querySelector('#sig-image-upload');
        
        // Canvas & Navigation
        const pdfCanvas = toolContentArea.querySelector('#pdf-render');
        const sigCanvas = toolContentArea.querySelector('#signature-layer');
        const btnPrev = toolContentArea.querySelector('#prev-page');
        const btnNext = toolContentArea.querySelector('#next-page');
        const pageSpan = toolContentArea.querySelector('#current-page-num');
        const totalSpan = toolContentArea.querySelector('#total-pages');
        const btnSave = toolContentArea.querySelector('#save-signed-pdf');
        
        // --- État global pour cette instance ---
        let pdfDoc = null;
        let pageNum = 1;
        let pdfScale = 1.0; 
        let isDrawing = false;
        let currentTool = 'draw'; 
        let signatureData = {}; 
        let currentPdfFile = null;

        // --- 1. Chargement du PDF ---
        const loadPDF = async (file) => {
            currentPdfFile = file;
            const arrayBuffer = await file.arrayBuffer();
            const { getDocument } = window.pdfjsLib;
            
            try {
                pdfDoc = await getDocument(arrayBuffer).promise;
                totalSpan.textContent = pdfDoc.numPages;
                pageNum = 1;
                
                dropZone.classList.add('hidden');
                workspace.classList.remove('hidden');
                
                renderPage(pageNum);
            } catch (err) {
                console.error("Erreur chargement PDF:", err);
                alert("Impossible de lire le PDF.");
            }
        };

        // --- 2. Rendu de la page ---
        const renderPage = async (num) => {
            saveCurrentSignature(); 
            
            pageSpan.textContent = num;
            const page = await pdfDoc.getPage(num);
            const containerWidth = toolContentArea.querySelector('#pdf-render-container').clientWidth - 40;
            const viewport = page.getViewport({ scale: 1 });
            pdfScale = containerWidth / viewport.width;
            if (pdfScale > 1.5) pdfScale = 1.5;
            
            const scaledViewport = page.getViewport({ scale: pdfScale });

            if(pdfCanvas) {
                pdfCanvas.width = scaledViewport.width;
                pdfCanvas.height = scaledViewport.height;
            }
            if(sigCanvas) {
                sigCanvas.width = scaledViewport.width;
                sigCanvas.height = scaledViewport.height;
            }

            const renderContext = {
                canvasContext: pdfCanvas.getContext('2d'),
                viewport: scaledViewport
            };
            await page.render(renderContext).promise;

            const ctx = sigCanvas.getContext('2d');
            ctx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
            if (signatureData[num]) {
                ctx.drawImage(signatureData[num], 0, 0);
            }
        };

        // --- 3. Gestion du Dessin ---
        if(sigCanvas) {
            const ctx = sigCanvas.getContext('2d');
            
            const getTouchPos = (e) => {
                const rect = sigCanvas.getBoundingClientRect();
                const clientX = e.touches ? e.touches[0].clientX : e.clientX;
                const clientY = e.touches ? e.touches[0].clientY : e.clientY;
                return { x: clientX - rect.left, y: clientY - rect.top };
            };

            const startDraw = (e) => {
                e.preventDefault();
                isDrawing = true;
                const pos = getTouchPos(e);
                ctx.beginPath();
                ctx.moveTo(pos.x, pos.y);
                ctx.lineWidth = widthInput.value;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';

                if (currentTool === 'eraser') {
                    ctx.globalCompositeOperation = 'destination-out';
                    ctx.lineWidth = widthInput.value * 5;
                } else {
                    ctx.globalCompositeOperation = 'source-over';
                    ctx.strokeStyle = colorInput.value;
                }
            };

            const draw = (e) => {
                if (!isDrawing) return;
                e.preventDefault();
                const pos = getTouchPos(e);
                ctx.lineTo(pos.x, pos.y);
                ctx.stroke();
            };

            const stopDraw = () => { isDrawing = false; };

            sigCanvas.addEventListener('mousedown', startDraw);
            sigCanvas.addEventListener('mousemove', draw);
            sigCanvas.addEventListener('mouseup', stopDraw);
            sigCanvas.addEventListener('mouseout', stopDraw);
            sigCanvas.addEventListener('touchstart', startDraw);
            sigCanvas.addEventListener('touchmove', draw);
            sigCanvas.addEventListener('touchend', stopDraw);
        }
        
        // --- 4. Outils Toolbar ---
        const setActiveTool = (btn, mode) => {
            toolContentArea.querySelectorAll('.tool-group .icon-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentTool = mode;
            if(sigCanvas) sigCanvas.style.cursor = mode === 'eraser' ? 'not-allowed' : 'crosshair';
        };

        if(toolDraw) toolDraw.addEventListener('click', () => setActiveTool(toolDraw, 'draw'));
        if(toolEraser) toolEraser.addEventListener('click', () => setActiveTool(toolEraser, 'eraser'));
        
        if(btnClear) btnClear.addEventListener('click', () => {
             const ctx = sigCanvas.getContext('2d');
             ctx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
        });

        if(toolImage) toolImage.addEventListener('click', () => imgUpload.click());
        if(imgUpload) imgUpload.addEventListener('change', (e) => {
             const file = e.target.files[0];
             if(file) {
                 const img = new Image();
                 img.onload = () => {
                     const ratio = img.width / img.height;
                     const w = Math.min(200, sigCanvas.width / 2);
                     const h = w / ratio;
                     const ctx = sigCanvas.getContext('2d');
                     ctx.globalCompositeOperation = 'source-over';
                     ctx.drawImage(img, (sigCanvas.width - w)/2, (sigCanvas.height - h)/2, w, h);
                 };
                 img.src = URL.createObjectURL(file);
             }
        });

        // --- 5. Navigation ---
        const saveCurrentSignature = () => {
            if (!pdfDoc) return;
            createImageBitmap(sigCanvas).then(bitmap => {
                signatureData[pageNum] = bitmap;
            });
        };

        if(btnPrev) btnPrev.addEventListener('click', () => {
            if (pageNum <= 1) return;
            pageNum--;
            renderPage(pageNum);
        });

        if(btnNext) btnNext.addEventListener('click', () => {
            if (pageNum >= pdfDoc.numPages) return;
            pageNum++;
            renderPage(pageNum);
        });

        // Gestion Drop & Input
        if(dropZone && pdfInput) {
            dropZone.addEventListener('click', () => pdfInput.click());
            dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--primary)'; });
            dropZone.addEventListener('dragleave', (e) => { dropZone.style.borderColor = 'var(--glass-border)'; });
            dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                if (e.dataTransfer.files[0]) loadPDF(e.dataTransfer.files[0]);
            });
            pdfInput.addEventListener('change', (e) => { if(e.target.files[0]) loadPDF(e.target.files[0]); });
        }

        // --- 6. Sauvegarde Finale ---
        if(btnSave) {
            btnSave.addEventListener('click', async () => {
                saveCurrentSignature();
                const status = toolContentArea.querySelector('#sig-status');
                status.classList.remove('hidden');
                status.innerHTML = '<div class="loader"></div><p>Fusion des signatures...</p>';
                
                try {
                    const arrayBuffer = await currentPdfFile.arrayBuffer();
                    const { PDFDocument } = PDFLib; 
                    const pdf = await PDFDocument.load(arrayBuffer);
                    
                    for (const [pNum, bitmap] of Object.entries(signatureData)) {
                        const tempCanvas = document.createElement('canvas');
                        tempCanvas.width = bitmap.width;
                        tempCanvas.height = bitmap.height;
                        const tCtx = tempCanvas.getContext('2d');
                        tCtx.drawImage(bitmap, 0, 0);
                        const pngData = tempCanvas.toDataURL('image/png');
                        
                        const image = await pdf.embedPng(pngData);
                        const page = pdf.getPage(parseInt(pNum) - 1);
                        const { width, height } = page.getSize();
                        
                        page.drawImage(image, { x: 0, y: 0, width: width, height: height });
                    }
                    
                    const pdfBytes = await pdf.save();
                    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
                    const link = document.createElement('a');
                    link.href = URL.createObjectURL(blob);
                    link.download = `signed_${currentPdfFile.name}`;
                    link.click();
                    
                    status.innerHTML = '<i class="fa-solid fa-check" style="color: #00C851;"></i><p>Document signé téléchargé !</p>';
                    setTimeout(() => status.classList.add('hidden'), 3000);

                } catch (err) {
                    console.error("Erreur Sauvegarde:", err);
                    alert("Erreur lors de la sauvegarde du PDF.");
                }
            });
        }
    }

    function setupDrawingTool(config) {
        // Similaire à Signature mais avec Marqueur et config Annotations
        const dropZone = toolContentArea.querySelector('#draw-pdf-drop');
        const pdfInput = toolContentArea.querySelector('.pdf-input');
        const workspace = toolContentArea.querySelector('#drawing-workspace');
        
        const toolPen = toolContentArea.querySelector('#draw-tool-pen');
        const toolMarker = toolContentArea.querySelector('#draw-tool-marker');
        const toolEraser = toolContentArea.querySelector('#draw-tool-eraser');
        const colorInput = toolContentArea.querySelector('#draw-color');
        const widthInput = toolContentArea.querySelector('#draw-width');
        const btnUndo = toolContentArea.querySelector('#draw-undo');
        const btnClear = toolContentArea.querySelector('#draw-clear');
        
        const pdfCanvas = toolContentArea.querySelector('#draw-pdf-render');
        const drawCanvas = toolContentArea.querySelector('#draw-layer');
        const btnPrev = toolContentArea.querySelector('#draw-prev-page');
        const btnNext = toolContentArea.querySelector('#draw-next-page');
        const pageSpan = toolContentArea.querySelector('#draw-page-num');
        const totalSpan = toolContentArea.querySelector('#draw-total-pages');
        const btnSave = toolContentArea.querySelector('#save-drawn-pdf');
        
        let pdfDoc = null;
        let pageNum = 1;
        let pdfScale = 1.0; 
        let isDrawing = false;
        let currentTool = 'pen';
        let drawingData = {};
        let currentDrawFile = null;

        const loadDrawPDF = async (file) => {
            currentDrawFile = file;
            const arrayBuffer = await file.arrayBuffer();
            const { getDocument } = window.pdfjsLib;
            try {
                pdfDoc = await getDocument(arrayBuffer).promise;
                totalSpan.textContent = pdfDoc.numPages;
                pageNum = 1;
                dropZone.classList.add('hidden');
                workspace.classList.remove('hidden');
                renderDrawPage(pageNum);
            } catch (err) { alert("Impossible de lire le PDF."); }
        };

        const renderDrawPage = async (num) => {
            saveCurrentDrawing();
            pageSpan.textContent = num;
            const page = await pdfDoc.getPage(num);
            const containerWidth = toolContentArea.querySelector('#draw-render-container').clientWidth - 40;
            const viewport = page.getViewport({ scale: 1 });
            pdfScale = containerWidth / viewport.width;
            if (pdfScale > 1.5) pdfScale = 1.5;
            
            const scaledViewport = page.getViewport({ scale: pdfScale });

            if(pdfCanvas) { pdfCanvas.width = scaledViewport.width; pdfCanvas.height = scaledViewport.height; }
            if(drawCanvas) { drawCanvas.width = scaledViewport.width; drawCanvas.height = scaledViewport.height; }

            await page.render({ canvasContext: pdfCanvas.getContext('2d'), viewport: scaledViewport }).promise;

            const ctx = drawCanvas.getContext('2d');
            ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
            if (drawingData[num]) ctx.drawImage(drawingData[num], 0, 0);
        };

        if(drawCanvas) {
            const ctx = drawCanvas.getContext('2d');
            const getDrawPos = (e) => {
                const rect = drawCanvas.getBoundingClientRect();
                const clientX = e.touches ? e.touches[0].clientX : e.clientX;
                const clientY = e.touches ? e.touches[0].clientY : e.clientY;
                return { x: clientX - rect.left, y: clientY - rect.top };
            };
            const startDrawing = (e) => {
                e.preventDefault();
                isDrawing = true;
                const pos = getDrawPos(e);
                ctx.beginPath();
                ctx.moveTo(pos.x, pos.y);
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                if (currentTool === 'eraser') {
                    ctx.globalCompositeOperation = 'destination-out';
                    ctx.lineWidth = widthInput.value * 5;
                    ctx.globalAlpha = 1.0;
                } else if (currentTool === 'marker') {
                    ctx.globalCompositeOperation = 'source-over';
                    ctx.strokeStyle = colorInput.value;
                    ctx.lineWidth = widthInput.value * 3;
                    ctx.globalAlpha = 0.5;
                } else {
                    ctx.globalCompositeOperation = 'source-over';
                    ctx.strokeStyle = colorInput.value;
                    ctx.lineWidth = widthInput.value;
                    ctx.globalAlpha = 1.0;
                }
            };
            const drawing = (e) => {
                if (!isDrawing) return;
                e.preventDefault();
                ctx.lineTo(getDrawPos(e).x, getDrawPos(e).y);
                ctx.stroke();
            };
            const stopDrawing = () => isDrawing = false;
            
            drawCanvas.addEventListener('mousedown', startDrawing);
            drawCanvas.addEventListener('mousemove', drawing);
            drawCanvas.addEventListener('mouseup', stopDrawing);
            drawCanvas.addEventListener('mouseout', stopDrawing);
            drawCanvas.addEventListener('touchstart', startDrawing);
            drawCanvas.addEventListener('touchmove', drawing);
            drawCanvas.addEventListener('touchend', stopDrawing);
        }

        const setActiveDrawTool = (btn, mode) => {
            toolContentArea.querySelectorAll('.tool-group .icon-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentTool = mode;
        };

        if(toolPen) toolPen.addEventListener('click', () => setActiveDrawTool(toolPen, 'pen'));
        if(toolMarker) toolMarker.addEventListener('click', () => setActiveDrawTool(toolMarker, 'marker'));
        if(toolEraser) toolEraser.addEventListener('click', () => setActiveDrawTool(toolEraser, 'eraser'));
        if(btnClear) btnClear.addEventListener('click', () => {
            const ctx = drawCanvas.getContext('2d');
            ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
        });

        const saveCurrentDrawing = () => {
             if (!pdfDoc) return;
             createImageBitmap(drawCanvas).then(bitmap => drawingData[pageNum] = bitmap);
        };

        if(btnPrev) btnPrev.addEventListener('click', () => { if (pageNum > 1) { pageNum--; renderDrawPage(pageNum); } });
        if(btnNext) btnNext.addEventListener('click', () => { if (pageNum < pdfDoc.numPages) { pageNum++; renderDrawPage(pageNum); } });

        if(dropZone && pdfInput) {
            dropZone.onclick = () => pdfInput.click();
            pdfInput.onchange = (e) => { if(e.target.files[0]) loadDrawPDF(e.target.files[0]); };
            dropZone.ondragover = (e) => { e.preventDefault(); };
            dropZone.ondrop = (e) => { e.preventDefault(); if(e.dataTransfer.files[0]) loadDrawPDF(e.dataTransfer.files[0]); };
        }

        if(btnSave) {
            btnSave.onclick = async () => {
                saveCurrentDrawing();
                const status = toolContentArea.querySelector('#draw-status');
                status.classList.remove('hidden');
                status.innerHTML = '<div class="loader"></div><p>Fusion du dessin...</p>';
                try {
                    const arrayBuffer = await currentDrawFile.arrayBuffer();
                    const { PDFDocument } = PDFLib;
                    const pdf = await PDFDocument.load(arrayBuffer);
                    for (const [pNum, bitmap] of Object.entries(drawingData)) {
                         const tempCanvas = document.createElement('canvas');
                         tempCanvas.width = bitmap.width; tempCanvas.height = bitmap.height;
                         tempCanvas.getContext('2d').drawImage(bitmap, 0, 0);
                         const img = await pdf.embedPng(tempCanvas.toDataURL('image/png'));
                         const page = pdf.getPage(parseInt(pNum) - 1);
                         page.drawImage(img, { x: 0, y: 0, width: page.getSize().width, height: page.getSize().height });
                    }
                    const pdfBytes = await pdf.save();
                    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
                    const link = document.createElement('a');
                    link.href = URL.createObjectURL(blob);
                    link.download = `drawn_${currentDrawFile.name}`;
                    link.click();
                    status.innerHTML = '<i class="fa-solid fa-check"></i> Succès';
                    setTimeout(() => status.classList.add('hidden'), 3000);
                } catch(e) { alert("Erreur sauvegarde: " + e.message); }
            };
        }
    }

    // --- REVIEWS LOGIC ---
    
    // Chargement des Avis
    const loadReviews = async () => {
        try {
            const res = await fetch('/api/reviews');
            const reviews = await res.json();
            const slider = document.getElementById('reviews-slider');
            
            if (reviews && reviews.length > 0) {
                slider.innerHTML = ''; // Clear default
                reviews.forEach((review, index) => {
                    const card = document.createElement('div');
                    card.className = `review-card ${index === 0 ? 'active' : ''}`;
                    card.innerHTML = `
                        <div class="review-avatar">${review.initials}</div>
                        <div class="review-content">
                            <h4>${review.name}</h4>
                            <p>"${review.text}"</p>
                            <div class="review-stars">
                                ${Array(parseInt(review.rating)).fill('<i class="fa-solid fa-star"></i>').join('')}
                            </div>
                        </div>
                    `;
                    slider.appendChild(card);
                });
            }
        } catch (e) {
            console.error('Error loading reviews:', e);
        }
    };

    // Défilement Auto Carrousel
    setInterval(() => {
        const slider = document.getElementById('reviews-slider');
        if (!slider) return;
        
        const cards = slider.querySelectorAll('.review-card');
        if (cards.length < 2) return;

        let activeIndex = Array.from(cards).findIndex(c => c.classList.contains('active'));
        let nextIndex = (activeIndex + 1) % cards.length;

        if (activeIndex !== -1) {
            cards[activeIndex].classList.remove('active');
            cards[activeIndex].classList.add('exit');
            
            setTimeout(() => {
                cards[activeIndex].classList.remove('exit');
            }, 500);
        }

        cards[nextIndex].classList.add('active');
    }, 10000); // 10 seconds

    // Chargement Initial
    loadReviews();

    // Soumission d'Avis
    const reviewForm = document.getElementById('review-form');
    if (reviewForm) {
        // Logique Notation Étoiles
        const starContainer = reviewForm.querySelector('.star-rating');
        const hiddenInput = document.getElementById('review-rating');
        const stars = starContainer.querySelectorAll('i');

        stars.forEach(star => {
            star.addEventListener('click', () => {
                const rating = star.dataset.rating;
                hiddenInput.value = rating;
                stars.forEach(s => {
                    s.style.color = s.dataset.rating <= rating ? '#FFD700' : 'var(--text-muted)';
                });
            });
        });

        reviewForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('review-name').value;
            const text = document.getElementById('review-text').value;
            const rating = parseInt(hiddenInput.value);
            const statusArea = document.getElementById('review-status');

            statusArea.classList.remove('hidden');
            statusArea.textContent = 'Envoi en cours...';

            try {
                const res = await fetch('/api/reviews', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, text, rating })
                });
                
                if (res.ok) {
                    showStatus(statusArea, 'Merci ! Votre avis a été publié.', 'success');
                    reviewForm.reset();
                    // Reset stars
                    stars.forEach(s => s.style.color = '#FFD700');
                    loadReviews(); // Refresh carousel
                } else {
                    throw new Error('Erreur lors de la publication');
                }
            } catch (err) {
                showStatus(statusArea, 'Erreur lors de l\'envoi de l\'avis.', 'error');
            }
        });
    }
    // --- UTILITIES EXPRESS LOGIC ---

    // Sélecteur d'Outils (QR Code vs Mot de passe)
    const utilModeBtns = document.querySelectorAll('.tool-mode-btn');
    const qrTool = document.getElementById('qrcode-tool');
    const passTool = document.getElementById('password-tool');

    utilModeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active class from all
            utilModeBtns.forEach(b => b.classList.remove('active'));
            // Add to clicked
            btn.classList.add('active');
            
            // Basculer le Contenu
            const toolType = btn.dataset.tool;
            if (toolType === 'qrcode') {
                qrTool.classList.remove('hidden');
                passTool.classList.add('hidden');
            } else if (toolType === 'password') {
                qrTool.classList.add('hidden');
                passTool.classList.remove('hidden');
            }
        });
    });

    // --- GÉNÉRATEUR QR CODE ---
    const qrData = document.getElementById('qr-data');
    const qrType = document.getElementById('qr-type');
    const qrColor = document.getElementById('qr-color');
    const qrStyle = document.getElementById('qr-style');
    const qrCanvasContainer = document.getElementById('qrcode-canvas');
    const generateQrBtn = document.getElementById('generate-qr-btn');
    const downloadQrPdfBtn = document.getElementById('download-qr-pdf');
    let qrCodeObj = null;

    if (qrType) {
        qrType.addEventListener('change', () => {
            const val = qrType.value;
            if (val === 'url') qrData.placeholder = 'https://votre-site.com';
            else if (val === 'text') qrData.placeholder = 'Entrez votre texte ici...';
            else if (val === 'wifi') qrData.placeholder = 'WIFI:S:NomDuWifi;T:WPA;P:MotDePasse;;';
            else if (val === 'email') qrData.placeholder = 'mailto:contact@email.com';
        });
    }

    const generateQRCode = () => {
        if (!qrData || !qrData.value) return;

        qrCanvasContainer.innerHTML = '';
        const color = qrColor.value;
        const style = qrStyle.value; 
        
        // Basic Init
        qrCodeObj = new QRCode(qrCanvasContainer, {
            text: qrData.value,
            width: 200,
            height: 200,
            colorDark : color,
            colorLight : "#ffffff",
            correctLevel : QRCode.CorrectLevel.H
        });
    };

    if (generateQrBtn) {
        generateQrBtn.addEventListener('click', generateQRCode);
    }
    
    // Reset QR
    const resetQrBtn = document.getElementById('reset-qr-btn');
    if (resetQrBtn) {
        resetQrBtn.addEventListener('click', () => {
             qrData.value = '';
             qrCanvasContainer.innerHTML = '';
        });
    }

    if (downloadQrPdfBtn) {
        downloadQrPdfBtn.addEventListener('click', () => {
            const canvas = qrCanvasContainer.querySelector('canvas');
            if (!canvas) {
                alert('Veuillez d\'abord générer un QR Code.');
                return;
            }
            
            const imgData = canvas.toDataURL('image/png');
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF();

            pdf.setFontSize(22);
            pdf.text("Mon QR Code", 105, 40, { align: "center" });
            
            const imgWidth = 100;
            const imgHeight = 100;
            const x = (210 - imgWidth) / 2;
            
            pdf.addImage(imgData, 'PNG', x, 60, imgWidth, imgHeight);
            
            pdf.setFontSize(12);
            pdf.text("Généré avec MediaMaster", 105, 280, { align: "center" });
            
            pdf.save("qrcode_mediamaster.pdf");
        });
    }


    // --- GÉNÉRATEUR DE MOT DE PASSE ---
    const passLength = document.getElementById('pass-length');
    const passLengthVal = document.getElementById('pass-length-val');
    const passUpper = document.getElementById('pass-uppercase');
    const passNumbers = document.getElementById('pass-numbers');
    const passSymbols = document.getElementById('pass-symbols');
    const passKeywords = document.getElementById('pass-keywords'); 
    const generatePassBtn = document.getElementById('generate-pass-btn');
    const passResult = document.getElementById('password-result');
    const copyPassBtn = document.getElementById('copy-password');
    const strengthBar = document.querySelector('.strength-bar');
    const strengthText = document.querySelector('.strength-text');

    if (passLength) {
        passLength.addEventListener('input', () => {
            passLengthVal.textContent = passLength.value;
        });
    }

    const calculateStrength = (password) => {
        if (!password) return 0;
        if (window.zxcvbn) {
            const r = window.zxcvbn(password);
            return Math.min(100, r.score * 25);
        }
        let strength = 0;
        if (password.length > 8) strength += 20;
        if (password.length > 12) strength += 20;
        if (/[A-Z]/.test(password)) strength += 20;
        if (/[0-9]/.test(password)) strength += 20;
        if (/[^A-Za-z0-9]/.test(password)) strength += 20;
        return Math.min(100, strength);
    };

    const estimateCrackTime = (password) => {
        if (!password) return "...";
        if (window.zxcvbn) {
            const r = window.zxcvbn(password);
            return r.crack_times_display.offline_slow_hashing_1e4_per_second || r.crack_times_display.offline_fast_hashing_1e10_per_second;
        }
        const poolSize = 94;
        const combinations = Math.pow(poolSize, password.length);
        const speed = 1e9;
        const seconds = combinations / speed;
        if (seconds < 1) return "Instantané";
        if (seconds < 60) return `${Math.round(seconds)} secondes`;
        if (seconds < 3600) return `${Math.round(seconds/60)} minutes`;
        if (seconds < 86400) return `${Math.round(seconds/3600)} heures`;
        if (seconds < 31536000) return `${Math.round(seconds/86400)} jours`;
        if (seconds < 3153600000) return `${Math.round(seconds/31536000)} années`;
        return "Des siècles";
    };

    const updateTestUI = (password) => {
        const bar = document.getElementById('test-strength-bar');
        const text = document.getElementById('test-strength-text');
        const timeText = document.getElementById('test-crack-time');
        
        if (!bar) return;

        if (!password) {
            bar.style.width = '0%';
            text.textContent = 'Force: 0%';
            timeText.textContent = 'Temps de crack: ...';
            return;
        }

        const strength = calculateStrength(password);
        const time = estimateCrackTime(password);
        
        bar.style.width = `${strength}%`;
        text.textContent = `Force: ${strength}%`;
        timeText.textContent = `Temps de crack: ${time}`;

        if (strength < 40) {
            bar.style.background = '#ff4444';
        } else if (strength < 70) {
            bar.style.background = '#ffbb33';
        } else {
            bar.style.background = '#00C851';
        }
    };

    const testPassInput = document.getElementById('test-password-input');
    if (testPassInput) {
        testPassInput.addEventListener('input', (e) => updateTestUI(e.target.value));
    }


    const updateStrengthMeter = (password) => {
        const strength = calculateStrength(password);
        if (strengthBar) {
            strengthBar.style.width = `${strength}%`;
            if (strength < 40) {
                strengthBar.style.backgroundColor = '#ff4444';
                if(strengthText) strengthText.textContent = 'Force : Faible 😟';
            } else if (strength < 70) {
                strengthBar.style.backgroundColor = '#ffbb33';
                if(strengthText) strengthText.textContent = 'Force : Moyenne 😐';
            } else {
                strengthBar.style.backgroundColor = '#00C851';
                if(strengthText) strengthText.textContent = 'Force : Excellente 😎';
            }
        }
    };

    const generatePassword = () => {
        const len = parseInt(passLength.value);
        const hasUpper = passUpper.checked;
        const hasNumbers = passNumbers.checked;
        const hasSymbols = passSymbols.checked;
        const keywords = passKeywords.value.trim();

        let password = "";

        if (keywords) {
            // Mode Mnémonique
            const map = { 'a': '@', 'e': '3', 'i': '1', 'o': '0', 's': '$', 't': '7' };
            password = keywords.split(/[\s,]+/).map(word => {
                let transformed = word.split('').map(c => map[c.toLowerCase()] || c).join('');
                if (hasUpper) transformed = transformed.charAt(0).toUpperCase() + transformed.slice(1);
                return transformed;
            }).join(hasSymbols ? '!' : '-');
            
            if (hasNumbers && !/\d/.test(password)) {
                password += Math.floor(Math.random() * 100);
            }
            
        } else {
            // Mode Aléatoire
            const lower = "abcdefghijklmnopqrstuvwxyz";
            const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
            const numbers = "0123456789";
            const symbols = "!@#$%^&*()_+~`|}{[]:;?><,./-=";
            
            let chars = lower;
            if (hasUpper) chars += upper;
            if (hasNumbers) chars += numbers;
            if (hasSymbols) chars += symbols;

            for (let i = 0; i < len; i++) {
                password += chars.charAt(Math.floor(Math.random() * chars.length));
            }
        }
        
        passResult.value = password;
        updateStrengthMeter(password);
        // Aussi mettre à jour le testeur si on veut que l'utilisateur voit direct la force de ce qu'il a généré (optionnel)
        // Mais le testeur est un input à part. On pourrait copier le mot de passe généré dans le testeur pour démo.
        const testInput = document.getElementById('test-password-input');
        if(testInput) {
            testInput.value = password;
            updateTestUI(password);
        }
    };
    
    // Reset Password
    const resetPassBtn = document.getElementById('reset-pass-btn');
    if (resetPassBtn) {
        resetPassBtn.addEventListener('click', () => {
            passResult.value = '';
            const testInput = document.getElementById('test-password-input');
            if(testInput) {
                testInput.value = '';
                updateTestUI('');
            }
            if(strengthBar) strengthBar.style.width = '0%';
            document.getElementById('pass-length').value = 16;
            document.getElementById('pass-length-val').textContent = '16';
        });
    }

    // Génération du mot de passe
    if (generatePassBtn) {
        generatePassBtn.addEventListener('click', () => {
            // Appel de la fonction de génération
            generatePassword();
            
            // Après génération, on affiche le bouton d'export PDF
            const exportPdfBtn = document.getElementById('export-pass-pdf-btn');
            if (exportPdfBtn) {
                exportPdfBtn.classList.remove('hidden');
            }
        });
    }

    // Gestion du bouton copier
    if (copyPassBtn) {
        copyPassBtn.addEventListener('click', () => {
            if (passResult.value) {
                navigator.clipboard.writeText(passResult.value).then(() => {
                    const originalIcon = copyPassBtn.innerHTML;
                    copyPassBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
                    setTimeout(() => copyPassBtn.innerHTML = originalIcon, 2000);
                });
            }
        });
    }

    // === EXPORT PDF MOT DE PASSE ===
    const exportPassPdfBtn = document.getElementById('export-pass-pdf-btn');
    const passDescModal = document.getElementById('password-description-modal');
    const closePassModal = document.getElementById('close-pass-modal');
    const confirmExportPdf = document.getElementById('confirm-export-pdf');
    const passDescInput = document.getElementById('pass-pdf-description');

    // Ouvrir le modal quand on clique sur "Télécharger en PDF"
    if (exportPassPdfBtn) {
        exportPassPdfBtn.addEventListener('click', () => {
            if (!passResult.value) {
                alert('Veuillez d\'abord générer un mot de passe.');
                return;
            }
            // Afficher le modal
            passDescModal.classList.remove('hidden');
            setTimeout(() => passDescModal.classList.add('active'), 10);
            passDescInput.value = ''; // Réinitialiser le champ
            passDescInput.focus();
        });
    }

    // Fermer le modal
    if (closePassModal) {
        closePassModal.addEventListener('click', () => {
            passDescModal.classList.remove('active');
            setTimeout(() => passDescModal.classList.add('hidden'), 300);
        });
    }

    // Générer le PDF quand on confirme
    if (confirmExportPdf) {
        confirmExportPdf.addEventListener('click', () => {
            const password = passResult.value;
            const description = passDescInput.value.trim() || 'Mot de passe sécurisé';
            const strength = calculateStrength(password);
            const currentDate = new Date().toLocaleDateString('fr-FR', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });

            // Création du PDF avec jsPDF
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF();

            // En-tête avec logo/titre
            pdf.setFillColor(139, 92, 246); // Couleur violet (--primary)
            pdf.rect(0, 0, 210, 40, 'F');
            pdf.setTextColor(255, 255, 255);
            pdf.setFontSize(28);
            pdf.text('🔐 MediaMaster Security', 105, 25, { align: 'center' });

            // Corps du document
            pdf.setTextColor(0, 0, 0);
            pdf.setFontSize(16);
            pdf.text('Mot de Passe Généré', 105, 60, { align: 'center' });

            // Description
            pdf.setFontSize(12);
            pdf.setTextColor(100, 100, 100);
            pdf.text(`Description : ${description}`, 20, 75);

            // Mot de passe en gros avec police monospace
            pdf.setFontSize(18);
            pdf.setFont('courier', 'bold');
            pdf.setTextColor(0, 0, 0);
            const passY = 95;
            pdf.text(password, 105, passY, { align: 'center' });

            // Cadre autour du mot de passe
            pdf.setDrawColor(139, 92, 246);
            pdf.setLineWidth(0.5);
            pdf.rect(15, passY - 10, 180, 20, 'S');

            // Niveau de force
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(12);
            let strengthText = '';
            let strengthColor = [0, 0, 0];
            if (strength < 40) {
                strengthText = 'Force : Faible 😟';
                strengthColor = [255, 68, 68];
            } else if (strength < 70) {
                strengthText = 'Force : Moyenne 😐';
                strengthColor = [255, 187, 51];
            } else {
                strengthText = 'Force : Excellente 😎';
                strengthColor = [0, 200, 81];
            }
            pdf.setTextColor(...strengthColor);
            pdf.text(strengthText, 105, 125, { align: 'center' });

            // Informations complémentaires
            pdf.setTextColor(100, 100, 100);
            pdf.setFontSize(10);
            pdf.text(`Date de génération : ${currentDate}`, 20, 145);
            pdf.text(`Longueur : ${password.length} caractères`, 20, 155);

            // Conseils de sécurité
            pdf.setFontSize(11);
            pdf.setTextColor(0, 0, 0);
            pdf.text('🛡️ Conseils de Sécurité :', 20, 175);
            const tips = [
                '1. Ne partagez jamais ce mot de passe par email ou SMS',
                '2. Changez-le régulièrement (tous les 3-6 mois)',
                '3. Utilisez un gestionnaire de mots de passe',
                '4. Activez la double authentification quand c\'est possible'
            ];
            pdf.setFontSize(9);
            pdf.setTextColor(80, 80, 80);
            tips.forEach((tip, index) => {
                pdf.text(tip, 25, 185 + (index * 8));
            });

            // Pied de page
            pdf.setFontSize(8);
            pdf.setTextColor(150, 150, 150);
            pdf.text('Généré par MediaMaster - 100% sécurisé et confidentiel', 105, 280, { align: 'center' });

            // Télécharger le PDF
            const fileName = `password_${description.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.pdf`;
            pdf.save(fileName);

            // Fermer le modal
            passDescModal.classList.remove('active');
            setTimeout(() => passDescModal.classList.add('hidden'), 300);
        });
    }

    // === OUTIL FILIGRANE (Refactorisé) ===
    function setupWatermarkTool(config) {
        // Sélecteurs scopés dans toolContentArea
        const wmText = toolContentArea.querySelector('.watermark-text');
        const wmColor = toolContentArea.querySelector('.watermark-color');
        const wmFont = toolContentArea.querySelector('.watermark-font');
        const wmSize = toolContentArea.querySelector('.watermark-size');
        const wmOpacity = toolContentArea.querySelector('.watermark-opacity');
        const wmAngle = toolContentArea.querySelector('.watermark-angle');
        const wmCount = toolContentArea.querySelector('.watermark-count');
        
        const previewText = toolContentArea.querySelector('.preview-watermark');
        const applyBtn = toolContentArea.querySelector('.process-btn');
        const pdfInput = toolContentArea.querySelector('input[type="file"]');
        const statusArea = toolContentArea.querySelector('.status-area');
        const dropZone = toolContentArea.querySelector('.drop-zone');

        // Gestion Drop PDF
        if(dropZone && pdfInput) setupDropZoneLogic(dropZone, pdfInput);

        // Update Preview
        const updatePreview = () => {
            if(!previewText) return;
            const text = wmText.value || 'CONFIDENTIEL';
            const color = wmColor.value;
            const font = wmFont.value;
            const size = wmSize.value;
            const opacity = wmOpacity.value / 100;
            const angle = wmAngle.value;
            
            toolContentArea.querySelector('.watermark-size-val').textContent = size;
            toolContentArea.querySelector('.watermark-opacity-val').textContent = wmOpacity.value;
            toolContentArea.querySelector('.watermark-angle-val').textContent = angle;
            toolContentArea.querySelector('.watermark-count-val').textContent = wmCount.value;

            previewText.textContent = text;
            previewText.style.color = color;
            previewText.style.fontFamily = font;
            previewText.style.fontSize = `${size}px`;
            previewText.style.opacity = opacity;
            previewText.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;
        };

        [wmText, wmColor, wmFont, wmSize, wmOpacity, wmAngle, wmCount].forEach(input => {
            if(input) input.addEventListener('input', updatePreview);
        });

        // Apply Logic (pdf-lib)
         if(applyBtn) {
            applyBtn.addEventListener('click', async () => {
                const file = pdfInput.files[0];
                if (!file) {
                    alert('Veuillez sélectionner un fichier PDF.');
                    return;
                }

                statusArea.classList.remove('hidden');
                statusArea.innerHTML = '<div class="loader"></div><p>Traitement du PDF en cours...</p>';

                try {
                    const arrayBuffer = await file.arrayBuffer();
                    const { PDFDocument, rgb, degrees, StandardFonts } = PDFLib;
                    const pdfDoc = await PDFDocument.load(arrayBuffer);
                    const pages = pdfDoc.getPages();

                    const text = wmText.value || 'CONFIDENTIEL';
                    const size = parseInt(wmSize.value);
                    const opacity = parseInt(wmOpacity.value) / 100;
                    const angle = parseInt(wmAngle.value);
                    const count = parseInt(wmCount.value);
                    
                    const hexToRgb = (hex) => {
                        const r = parseInt(hex.slice(1, 3), 16) / 255;
                        const g = parseInt(hex.slice(3, 5), 16) / 255;
                        const b = parseInt(hex.slice(5, 7), 16) / 255;
                        return rgb(r, g, b);
                    };
                    const colorRgb = hexToRgb(wmColor.value);

                    let fontEmbed;
                    const fontVal = wmFont.value;
                    if (fontVal.includes('Times')) fontEmbed = await pdfDoc.embedFont(StandardFonts.TimesRoman);
                    else if (fontVal.includes('Courier')) fontEmbed = await pdfDoc.embedFont(StandardFonts.Courier);
                    else fontEmbed = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

                    for (const page of pages) {
                        const { width, height } = page.getSize();
                        
                        if (count === 1) {
                            page.drawText(text, {
                                x: width / 2 - (size * text.length / 4),
                                y: height / 2,
                                size: size,
                                font: fontEmbed,
                                color: colorRgb,
                                opacity: opacity,
                                rotate: degrees(angle),
                            });
                        } else {
                            const rows = Math.ceil(Math.sqrt(count));
                            const cols = Math.ceil(count / rows);
                            const xStep = width / cols;
                            const yStep = height / rows;

                            for (let i = 0; i < cols; i++) {
                                for (let j = 0; j < rows; j++) {
                                    const x = (i * xStep) + (xStep / 2) - 50; 
                                    const y = (j * yStep) + (yStep / 2);
                                    
                                    page.drawText(text, {
                                        x: x,
                                        y: y,
                                        size: size,
                                        font: fontEmbed,
                                        color: colorRgb,
                                        opacity: opacity,
                                        rotate: degrees(angle),
                                    });
                                }
                            }
                        }
                    }

                    const pdfBytes = await pdfDoc.save();
                    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
                    const link = document.createElement('a');
                    link.href = URL.createObjectURL(blob);
                    link.download = `watermarked_${file.name}`;
                    link.click();

                    statusArea.innerHTML = '<i class="fa-solid fa-check" style="color: #00C851;"></i><p>Filigrane ajouté avec succès !</p>';
                    setTimeout(() => statusArea.classList.add('hidden'), 3000);

                } catch (err) {
                    console.error("Erreur PDF:", err);
                    statusArea.innerHTML = `<i class="fa-solid fa-times" style="color: #ff4444;"></i><p>Erreur: ${err.message}</p>`;
                }
            });
         }
         
         // Helper for dropzone
         function setupDropZoneLogic(drop, input) {
             drop.onclick = () => input.click();
             input.onchange = () => {
                 if(input.files[0]) {
                     drop.querySelector('p').textContent = input.files[0].name;
                     drop.style.borderColor = 'var(--primary)';
                 }
             };
         }
    }



    // End of setupVisualEditor
    // Ensure this is called correctly in initToolLogic
}); // End DOMContentLoaded


