document.addEventListener('DOMContentLoaded', () => {
  feather.replace();

  const SETTINGS_KEY = 'aetherfocus_settings_v7';
  const STATE_KEY = 'aetherfocus_state_v7';
  const BG_STORAGE_KEY = 'aetherfocus_custom_wallpaper_v7';

  // Persistent Configuration
  let config = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {
    focus: 25,
    short: 5,
    long: 15,
    sequence: ['FOCUS', 'SHORT', 'FOCUS', 'LONG'],
    repeatSequence: true,
    soundEnabled: true,
    accentRgb: [255, 255, 255],
    musicTrack: 'none',
    musicVolume: 0.5
  };

  let savedState = JSON.parse(localStorage.getItem(STATE_KEY)) || {};
  
  let state = {
    sequenceIndex: savedState.sequenceIndex !== undefined ? savedState.sequenceIndex : 0,
    timeLeft: savedState.timeLeft !== undefined ? savedState.timeLeft : config.focus * 60,
    isRunning: savedState.isRunning || false,
    completedPomodoros: savedState.completedPomodoros || 0,
    lastTimestamp: savedState.lastTimestamp || Date.now()
  };

  let timerInterval = null;

  /* Web Audio Synthesizer Engine */
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  function play5SecWarningSound() {
    if (!config.soundEnabled) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    
    gain.gain.setValueAtTime(0, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.08, audioCtx.currentTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.25);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.25);
  }

  function playFocusStartSound() {
    if (!config.soundEnabled) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const now = audioCtx.currentTime;
    const freqs = [130.81, 196.00, 246.94, 293.66, 329.63]; // C Major 9 Warm Pad
    
    freqs.forEach(freq => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.03, now + 0.8);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 3.0);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start(now);
      osc.stop(now + 3.0);
    });
  }

  /* Ambient Music Engine */
  let ambientAudioNodes = null;

  function stopAmbientMusic() {
    if (ambientAudioNodes) {
      try {
        ambientAudioNodes.masterGain.gain.linearRampToValueAtTime(0.0001, audioCtx.currentTime + 0.5);
        setTimeout(() => {
          if (ambientAudioNodes) {
            ambientAudioNodes.nodes.forEach(n => {
              if (n.stop) n.stop();
              if (n.disconnect) n.disconnect();
            });
            ambientAudioNodes = null;
          }
        }, 500);
      } catch (e) {
        ambientAudioNodes = null;
      }
    }
  }

  function playAmbientMusic(type) {
    stopAmbientMusic();
    if (type === 'none') return;
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const now = audioCtx.currentTime;
    const masterGain = audioCtx.createGain();
    masterGain.gain.setValueAtTime(0.0001, now);
    masterGain.gain.linearRampToValueAtTime(config.musicVolume, now + 1.5);
    masterGain.connect(audioCtx.destination);

    const nodes = [];

    if (type === 'binaural') {
      const leftOsc = audioCtx.createOscillator();
      const rightOsc = audioCtx.createOscillator();
      const merger = audioCtx.createChannelMerger(2);

      leftOsc.frequency.setValueAtTime(216, now);
      rightOsc.frequency.setValueAtTime(222, now);

      leftOsc.type = 'sine';
      rightOsc.type = 'sine';

      leftOsc.connect(merger, 0, 0);
      rightOsc.connect(merger, 0, 1);

      merger.connect(masterGain);
      leftOsc.start(now);
      rightOsc.start(now);

      nodes.push(leftOsc, rightOsc, merger);

    } else if (type === 'cozy') {
      const chords = [110.00, 164.81, 220.00, 277.18];
      chords.forEach(freq => {
        const osc = audioCtx.createOscillator();
        const filter = audioCtx.createBiquadFilter();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(350, now);

        osc.connect(filter);
        filter.connect(masterGain);

        osc.start(now);
        nodes.push(osc, filter);
      });
    }

    ambientAudioNodes = { masterGain, nodes };
  }

  function setMusicVolume(val) {
    config.musicVolume = parseFloat(val);
    saveConfig();
    if (ambientAudioNodes) {
      ambientAudioNodes.masterGain.gain.linearRampToValueAtTime(config.musicVolume, audioCtx.currentTime + 0.1);
    }
  }

  // Element Selectors
  const el = {
    modeLabel: document.getElementById('timer-mode'),
    startBtn: document.getElementById('start-pause-btn'),
    resetBtn: document.getElementById('reset-btn'),
    skipBtn: document.getElementById('skip-btn'),
    completedCount: document.getElementById('completed-count'),
    sessionDots: document.getElementById('session-dots'),
    settingsBtn: document.getElementById('settings-btn'),
    settingsDrawer: document.getElementById('settings-drawer'),
    closeSettingsBtn: document.getElementById('close-settings-drawer'),
    soundToggle: document.getElementById('sound-toggle'),
    inputFocus: document.getElementById('input-focus'),
    inputShort: document.getElementById('input-short'),
    inputLong: document.getElementById('input-long'),
    sequenceRail: document.getElementById('sequence-rail'),
    repeatToggle: document.getElementById('repeat-toggle'),
    bgFileInput: document.getElementById('bg-file-input'),
    removeBgBtn: document.getElementById('remove-bg-btn'),
    bgBase: document.getElementById('bg-base'),
    canvas: document.getElementById('ambient-canvas'),
    musicBtn: document.getElementById('music-toggle-btn'),
    musicPopover: document.getElementById('music-popover'),
    musicStatus: document.getElementById('music-status'),
    musicTrigger: document.getElementById('music-select-trigger'),
    musicOptions: document.getElementById('music-select-options'),
    selectedMusicText: document.getElementById('selected-music-text'),
    volumeRange: document.getElementById('music-volume')
  };

  function saveConfig() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(config));
  }

  function saveState() {
    state.lastTimestamp = Date.now();
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  }

  function getCurrentSequence() {
    return (config.sequence && config.sequence.length > 0) 
      ? config.sequence 
      : ['FOCUS', 'SHORT', 'FOCUS', 'LONG'];
  }

  function getCurrentMode() {
    const sequence = getCurrentSequence();
    return sequence[state.sequenceIndex % sequence.length];
  }

  function getModeDuration(mode) {
    if (mode === 'SHORT') return config.short * 60;
    if (mode === 'LONG') return config.long * 60;
    return config.focus * 60;
  }

  /* Real-Time LocalStorage Timer Continuity Sync */
  function syncTimeOnLoad() {
    if (state.isRunning && state.lastTimestamp) {
      const elapsedSeconds = Math.floor((Date.now() - state.lastTimestamp) / 1000);
      if (elapsedSeconds > 0) {
        state.timeLeft -= elapsedSeconds;
        if (state.timeLeft <= 0) {
          handleComplete();
          return;
        }
      }
      startTimer(false);
    } else {
      updateDisplay();
    }
  }

  function updateDisplay() {
    const minutes = Math.floor(Math.max(0, state.timeLeft) / 60);
    const seconds = Math.max(0, state.timeLeft) % 60;
    
    const formattedMin = String(minutes).padStart(2, '0');
    const formattedSec = String(seconds).padStart(2, '0');
    
    document.title = `${formattedMin}:${formattedSec} — ${getCurrentMode()}`;

    triggerFlipUnit('flip-m1', formattedMin[0]);
    triggerFlipUnit('flip-m2', formattedMin[1]);
    triggerFlipUnit('flip-s1', formattedSec[0]);
    triggerFlipUnit('flip-s2', formattedSec[1]);
  }

  function triggerFlipUnit(unitId, newDigit) {
    const unit = document.getElementById(unitId);
    if (!unit) return;

    const topHalf = unit.querySelector('.top-half .digit');
    const bottomHalf = unit.querySelector('.bottom-half .digit');
    const flapTop = unit.querySelector('.flap-top');
    const flapTopDigit = flapTop.querySelector('.digit');
    const flapBottom = unit.querySelector('.flap-bottom');
    const flapBottomDigit = flapBottom.querySelector('.digit');

    const currentDigit = topHalf.textContent;
    if (currentDigit === newDigit) return;

    flapTopDigit.textContent = currentDigit;
    flapBottomDigit.textContent = newDigit;
    topHalf.textContent = newDigit;

    unit.classList.remove('animate-top', 'animate-bottom');
    void unit.offsetWidth;

    unit.classList.add('animate-top');

    setTimeout(() => {
      bottomHalf.textContent = newDigit;
      unit.classList.add('animate-bottom');
    }, 140);
  }

  function tick() {
    if (state.timeLeft > 0) {
      state.timeLeft--;

      if (state.timeLeft > 0 && state.timeLeft <= 5) {
        play5SecWarningSound();
      }

      saveState();
      updateDisplay();
    } else {
      handleComplete();
    }
  }

  function startTimer(shouldSave = true) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    if (getCurrentMode() === 'FOCUS' && state.timeLeft === getModeDuration('FOCUS')) {
      playFocusStartSound();
    }

    state.isRunning = true;
    el.startBtn.querySelector('span').textContent = 'PAUSE';
    clearInterval(timerInterval);
    timerInterval = setInterval(tick, 1000);
    if (shouldSave) saveState();
  }

  function pauseTimer() {
    state.isRunning = false;
    el.startBtn.querySelector('span').textContent = 'RESUME';
    clearInterval(timerInterval);
    saveState();
  }

  function resetTimer() {
    pauseTimer();
    state.timeLeft = getModeDuration(getCurrentMode());
    el.startBtn.querySelector('span').textContent = 'START';
    saveState();
    updateDisplay();
  }

  /* Completion Logic: Loops back to actual duration (No 00:00 freeze) */
  function handleComplete() {
    pauseTimer();
    const currentMode = getCurrentMode();

    if (currentMode === 'FOCUS') {
      state.completedPomodoros++;
    }

    const sequence = getCurrentSequence();
    const isAtEnd = state.sequenceIndex >= sequence.length - 1;

    if (isAtEnd && !config.repeatSequence) {
      state.sequenceIndex = 0;
      state.timeLeft = getModeDuration(getCurrentMode());
      el.startBtn.querySelector('span').textContent = 'START';
      applyCurrentState();
      return;
    }

    // Move to next step in workflow sequence
    state.sequenceIndex = (state.sequenceIndex + 1) % sequence.length;
    
    // Reset timer to exact duration specified in menu settings
    state.timeLeft = getModeDuration(getCurrentMode());
    
    applyCurrentState();
    startTimer();
  }

  function applyCurrentState() {
    const mode = getCurrentMode();
    el.modeLabel.textContent = mode === 'SHORT' ? 'SHORT BREAK' : mode === 'LONG' ? 'LONG BREAK' : 'FOCUS';
    el.completedCount.textContent = state.completedPomodoros;
    renderSessionDots();
    updateDisplay();
  }

  /* Dynamic Dots for Every Step in Sequence */
  function renderSessionDots() {
    const sequence = getCurrentSequence();
    el.sessionDots.innerHTML = '';
    
    sequence.forEach((mode, idx) => {
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.title = `${idx + 1}. ${mode}`;
      
      // Light up dot if current or already completed in this sequence round
      if (idx <= state.sequenceIndex) {
        dot.classList.add('active');
      }
      el.sessionDots.appendChild(dot);
    });
  }

  /* Visual Sequence Builder */
  function renderSequenceRail() {
    el.sequenceRail.innerHTML = '';
    if (config.sequence.length === 0) {
      el.sequenceRail.innerHTML = '<span style="font-size:0.7rem; opacity:0.4;">Add blocks above to build flow</span>';
      return;
    }

    config.sequence.forEach((item, index) => {
      const chip = document.createElement('div');
      chip.className = `flow-chip chip-${item}`;
      chip.innerHTML = `
        <span>${item}</span>
        <span class="chip-remove">✕</span>
      `;
      chip.addEventListener('click', () => {
        config.sequence.splice(index, 1);
        if (config.sequence.length === 0) {
          config.sequence = ['FOCUS'];
        }
        if (state.sequenceIndex >= config.sequence.length) {
          state.sequenceIndex = 0;
        }
        saveConfig();
        renderSequenceRail();
        applyCurrentState();
      });
      el.sequenceRail.appendChild(chip);
    });
  }

  document.querySelectorAll('.add-block-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.type;
      config.sequence.push(type);
      saveConfig();
      renderSequenceRail();
      applyCurrentState();
    });
  });

  /* Color Accent Sampler */
  function extractAccentColor(imgElement) {
    const tempCanvas = document.createElement('canvas');
    const ctx = tempCanvas.getContext('2d');
    tempCanvas.width = 50;
    tempCanvas.height = 50;
    
    ctx.drawImage(imgElement, 0, 0, 50, 50);
    const imageData = ctx.getImageData(0, 0, 50, 50).data;
    
    let r = 0, g = 0, b = 0, count = 0;
    for (let i = 0; i < imageData.length; i += 16) {
      const curR = imageData[i];
      const curG = imageData[i+1];
      const curB = imageData[i+2];
      const brightness = (curR + curG + curB) / 3;

      if (brightness > 30 && brightness < 220) {
        r += curR;
        g += curG;
        b += curB;
        count++;
      }
    }

    if (count > 0) {
      r = Math.round(r / count);
      g = Math.round(g / count);
      b = Math.round(b / count);
      return [r, g, b];
    }
    return [255, 255, 255];
  }

  function applyThemeColors(rgbArray) {
    config.accentRgb = rgbArray;
    saveConfig();
    document.documentElement.style.setProperty('--accent-rgb', rgbArray.join(','));
  }

  /* Reliable Background Atmosphere Persistence */
  function setBackground(dataUrl, saveStorage = true) {
    if (dataUrl) {
      if (saveStorage) {
        try {
          localStorage.setItem(BG_STORAGE_KEY, dataUrl);
        } catch (e) {
          console.warn('Wallpaper payload too large for direct LocalStorage storage.');
        }
      }
      el.bgBase.style.backgroundImage = `url(${dataUrl})`;
      el.removeBgBtn.style.display = 'block';

      const img = new Image();
      img.onload = () => {
        const sampledRgb = extractAccentColor(img);
        applyThemeColors(sampledRgb);
      };
      img.src = dataUrl;
    } else {
      localStorage.removeItem(BG_STORAGE_KEY);
      el.bgBase.style.backgroundImage = '';
      el.removeBgBtn.style.display = 'none';
      applyThemeColors([255, 255, 255]);
    }
    initAmbientParticles();
  }

  function compressAndSaveBg(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        const maxDim = 1920;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
        setBackground(compressedDataUrl, true);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  /* Dynamic Particle Canvas */
  const ctx = el.canvas.getContext('2d');
  let particles = [];

  function resizeCanvas() {
    el.canvas.width = window.innerWidth;
    el.canvas.height = window.innerHeight;
  }

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  function isCustomBgActive() {
    return !!localStorage.getItem(BG_STORAGE_KEY);
  }

  function initAmbientParticles() {
    particles = [];
    const hasCustomWallpaper = isCustomBgActive();
    const particleCount = hasCustomWallpaper ? 45 : 35;
    
    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * el.canvas.width,
        y: Math.random() * el.canvas.height,
        size: hasCustomWallpaper ? Math.random() * 14 + 6 : Math.random() * 2 + 0.5,
        alpha: Math.random() * 0.35 + 0.15,
        speedY: -(Math.random() * 0.4 + 0.15),
        speedX: (Math.random() - 0.5) * 0.3,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.02,
        points: [
          { x: 0, y: -(Math.random() * 6 + 4) },
          { x: Math.random() * 6 + 4, y: Math.random() * 4 },
          { x: Math.random() * 3, y: Math.random() * 6 + 4 },
          { x: -(Math.random() * 6 + 3), y: Math.random() * 3 }
        ]
      });
    }
  }

  function renderParticles() {
    ctx.clearRect(0, 0, el.canvas.width, el.canvas.height);
    const [r, g, b] = config.accentRgb || [255, 255, 255];
    const hasCustomWallpaper = isCustomBgActive();

    particles.forEach(p => {
      ctx.save();
      ctx.translate(p.x, p.y);

      if (hasCustomWallpaper) {
        ctx.rotate(p.rotation);
        ctx.beginPath();
        ctx.moveTo(p.points[0].x, p.points[0].y);
        for (let i = 1; i < p.points.length; i++) {
          ctx.lineTo(p.points[i].x, p.points[i].y);
        }
        ctx.closePath();

        ctx.fillStyle = `rgba(255, 255, 255, ${p.alpha * 0.3})`;
        ctx.fill();

        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${p.alpha * 0.75})`;
        ctx.lineWidth = 0.75;
        ctx.stroke();

        p.rotation += p.rotSpeed;
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${p.alpha})`;
        ctx.fill();
      }

      ctx.restore();

      p.y += p.speedY;
      p.x += p.speedX;

      if (p.y < -20) p.y = el.canvas.height + 20;
      if (p.x < -20 || p.x > el.canvas.width + 20) p.x = Math.random() * el.canvas.width;
    });

    requestAnimationFrame(renderParticles);
  }

  // Music Widget Listeners
  el.musicBtn.addEventListener('click', () => {
    el.musicPopover.classList.toggle('open');
  });

  document.addEventListener('click', (e) => {
    if (!el.musicPopover.contains(e.target) && !el.musicBtn.contains(e.target)) {
      el.musicPopover.classList.remove('open');
    }
    if (!el.musicTrigger.contains(e.target)) {
      el.musicOptions.classList.remove('show');
    }
  });

  el.musicTrigger.addEventListener('click', () => {
    el.musicOptions.classList.toggle('show');
  });

  document.querySelectorAll('.select-option').forEach(option => {
    option.addEventListener('click', () => {
      document.querySelectorAll('.select-option').forEach(o => o.classList.remove('active'));
      option.classList.add('active');

      const val = option.dataset.value;
      const text = option.textContent;

      el.selectedMusicText.textContent = text;
      el.musicOptions.classList.remove('show');

      config.musicTrack = val;
      saveConfig();

      if (val === 'none') {
        el.musicStatus.textContent = 'OFF';
        el.musicBtn.classList.remove('active');
        stopAmbientMusic();
      } else {
        el.musicStatus.textContent = 'PLAYING';
        el.musicBtn.classList.add('active');
        playAmbientMusic(val);
      }
    });
  });

  el.volumeRange.addEventListener('input', (e) => setMusicVolume(e.target.value));

  // Controls & Settings Listeners
  el.startBtn.addEventListener('click', () => state.isRunning ? pauseTimer() : startTimer());
  el.resetBtn.addEventListener('click', resetTimer);
  el.skipBtn.addEventListener('click', () => {
    const sequence = getCurrentSequence();
    state.sequenceIndex = (state.sequenceIndex + 1) % sequence.length;
    state.timeLeft = getModeDuration(getCurrentMode());
    applyCurrentState();
    if (state.isRunning) {
      startTimer();
    } else {
      updateDisplay();
    }
  });

  el.settingsBtn.addEventListener('click', () => {
    el.inputFocus.value = config.focus;
    el.inputShort.value = config.short;
    el.inputLong.value = config.long;
    el.repeatToggle.checked = config.repeatSequence;
    el.soundToggle.checked = config.soundEnabled;
    renderSequenceRail();
    el.settingsDrawer.classList.add('open');
  });
  
  el.closeSettingsBtn.addEventListener('click', () => el.settingsDrawer.classList.remove('open'));

  el.soundToggle.addEventListener('change', () => {
    config.soundEnabled = el.soundToggle.checked;
    saveConfig();
  });

  ['inputFocus', 'inputShort', 'inputLong'].forEach(id => {
    el[id].addEventListener('input', () => {
      config.focus = parseInt(el.inputFocus.value) || 25;
      config.short = parseInt(el.inputShort.value) || 5;
      config.long = parseInt(el.inputLong.value) || 15;
      saveConfig();
      if (!state.isRunning) {
        state.timeLeft = getModeDuration(getCurrentMode());
        saveState();
        updateDisplay();
      }
    });
  });

  el.repeatToggle.addEventListener('change', () => {
    config.repeatSequence = el.repeatToggle.checked;
    saveConfig();
  });

  el.bgFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) compressAndSaveBg(file);
  });

  el.removeBgBtn.addEventListener('click', () => setBackground(null));

  // Load Custom Atmosphere on Boot
  const storedWallpaper = localStorage.getItem(BG_STORAGE_KEY);
  if (storedWallpaper) {
    setBackground(storedWallpaper, false);
  }

  el.volumeRange.value = config.musicVolume;

  if (config.musicTrack && config.musicTrack !== 'none') {
    const activeOption = document.querySelector(`.select-option[data-value="${config.musicTrack}"]`);
    if (activeOption) {
      document.querySelectorAll('.select-option').forEach(o => o.classList.remove('active'));
      activeOption.classList.add('active');
      el.selectedMusicText.textContent = activeOption.textContent;
    }
  }

  // Initialize UI & Sync Continuity
  applyCurrentState();
  syncTimeOnLoad();
  initAmbientParticles();
  renderParticles();
});