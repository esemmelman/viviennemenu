(() => {
  const practiceButton = document.querySelector('#service-record-button');
  const playButton = document.querySelector('#service-play-button');
  const playbackPanel = document.querySelector('#service-playback');
  const status = document.querySelector('#service-playback-status');
  const exampleIds = {
    p: '93f616e9-04a7-4954-a7d4-4177da657bcb',
    g3eb74f277b9_0_9: '91b7e099-502a-49b1-8ddf-d70e45253b72',
    g3eb74f277b9_0_22: 'a8ef17bc-8fc6-473a-bcee-baf673d0a615',
    g3eb74f277b9_0_32: '0c06585c-66aa-467c-9c71-26bfc4f26085',
    g3eb74f277b9_0_61: '07b597b3-553d-4075-bf32-2e585b01d29d',
    g3eb7772bc9b_0_0: '71c6e513-fad6-4e01-a153-a24a40bad387',
    g3eb7772bc9b_0_16: '44e527fe-f365-43f7-b560-cd6ca244019c',
    g3e705dc12d8_0_9: 'fc76c910-a780-48b1-b0d4-e558bacbf044',
    g3e705dc12d8_0_18: '6828cb21-d6c3-48c4-a1a9-88604880aed9',
    g3e705dc12d8_0_25: '904ae9ec-dc5e-4233-973f-941e7e68ed50',
    g3e705dc12d8_0_34: '31e56364-779e-4a18-a462-a9783c582f46',
    g3e740b7777b_0_0: '03b51148-405b-4ab7-a384-5502dff59185',
    g3f776c0633e_0_20: 'd06cfd2d-e636-4d2d-b44e-ed00ade3d3c5'
  };
  let exampleId = null;
  const audio = new Audio();
  const button = practiceButton;
  let exampleAvailable = false;
  let loadVersion = 0;
  const endpoint = `${supabaseUrl}/rest/v1/bradymenu_service_recordings_v1`;
  let recorder = null;
  let busy = false;
  let timer;
  let silenceCheck;
  let audioContext;
  let pending = null;

  function resetPlayback() {
    audio.pause();
    audio.currentTime = 0;
    playButton.textContent = 'Play';
  }

  function updateControls() {
    const active = busy || !!recorder || !!pending;
    playButton.disabled = active || !exampleAvailable;
  }

  async function loadExample() {
    const version = ++loadVersion;
    exampleAvailable = false;
    audio.removeAttribute('src');
    updateControls();
    status.textContent = 'Loading example…';
    try {
      const response = await fetch(`${endpoint}?id=eq.${exampleId}&select=mime_type,audio_base64`, { headers: headers(exampleId) });
      if (!response.ok) throw new Error(`Load failed (${response.status})`);
      const [item] = await response.json();
      if (version !== loadVersion) return;
      exampleAvailable = !!item;
      if (item) audio.src = `data:${item.mime_type};base64,${item.audio_base64}`;
      status.textContent = item ? '' : 'No example recording is available yet.';
    } catch (error) {
      if (version !== loadVersion) return;
      console.error(error);
      status.textContent = 'Could not load the example. Reopen this passage to retry.';
    }
    updateControls();
  }

  window.showServicePlayback = slideId => {
    exampleId = exampleIds[slideId] || null;
    playbackPanel.hidden = !exampleId;
    resetPlayback();
    if (exampleId) loadExample();
    else ++loadVersion;
  };
  playButton.onclick = async () => {
    if (!audio.paused) { resetPlayback(); return; }
    try {
      await audio.play();
      playButton.textContent = 'Stop';
    } catch (error) {
      console.error(error);
      status.textContent = 'Playback failed. Press Play to retry.';
    }
  };
  audio.onended = resetPlayback;

  function headers(id, extra = {}) {
    return { ...supabaseHeaders, 'x-recording-id': id, ...extra };
  }

  function asBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function save(item) {
    const response = await fetch(`${endpoint}?on_conflict=id&select=id`, {
      method: 'POST',
      headers: headers(item.id, { Prefer: 'resolution=merge-duplicates,return=representation' }),
      body: JSON.stringify({
        id: item.id,
        name: 'Vivienne',
        start_time: item.start,
        passage_key_text: item.title,
        mime_type: item.blob.type.split(';')[0],
        audio_base64: await asBase64(item.blob)
      })
    });
    if (!response.ok) throw new Error(`Save failed (${response.status})`);
    const [saved] = await response.json();
    if (saved?.id !== item.id) throw new Error('Save was not confirmed');
  }

  async function saveWithRetry(item) {
    try {
      await save(item);
    } catch {
      await save(item);
    }
  }

  async function savePending() {
    busy = true;
    button.disabled = true;
    button.textContent = 'Saving…';
    try {
      await saveWithRetry(pending);
      pending = null;
      button.textContent = 'Record';
    } catch (error) {
      console.error(error);
      button.textContent = 'Retry save';
    } finally {
      busy = false;
      button.disabled = false;
      updateControls();
    }
  }

  function stop() {
    if (recorder?.state === 'recording') {
      button.disabled = true;
      recorder.stop();
      clearTimeout(timer);
      clearInterval(silenceCheck);
    }
  }
  window.stopServiceRecording = () => { stop(); resetPlayback(); };

  async function startRecording() {
    if (recorder?.state === 'recording') { stop(); return; }
    if (busy) return;
    if (pending) { await savePending(); return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      status.textContent = 'Audio recording is unavailable in this browser.';
      return;
    }
    busy = true;
    resetPlayback();
    ++loadVersion;
    updateControls();
    button.disabled = true;
    button.textContent = 'Stop Recording';
    button.setAttribute('aria-pressed', 'true');
    const item = { id: crypto.randomUUID(), title: window.servicePassageTitle, start: new Date().toISOString() };
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error('Silence detection is unavailable in this browser.');
      audioContext = new AudioContextClass();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      await audioContext.resume();
      if (audioContext.state !== 'running') throw new Error('Silence detection could not start.');
      const samples = new Float32Array(analyser.fftSize);
      const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus']
        .find(value => MediaRecorder.isTypeSupported(value));
      const capture = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks = [];
      capture.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      capture.onstop = async () => {
        clearTimeout(timer);
        clearInterval(silenceCheck);
        audioContext?.close().catch(console.error);
        audioContext = null;
        stream.getTracks().forEach(track => track.stop());
        recorder = null;
        busy = true;
        button.textContent = 'Record';
        button.setAttribute('aria-pressed', 'false');
        item.blob = new Blob(chunks, { type: capture.mimeType || type || 'audio/webm' });
        if (item.blob.size) {
          pending = item;
          await savePending();
        } else {
          busy = false;
          button.disabled = false;
          updateControls();
        }
      };
      capture.onerror = stop;
      capture.start(1000);
      recorder = capture;
      button.disabled = false;
      let lastSoundAt = performance.now();
      silenceCheck = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
        const now = performance.now();
        if (rms >= 0.012) lastSoundAt = now;
        else if (now - lastSoundAt >= 10000) stop();
      }, 250);
      timer = setTimeout(stop, 240000);
      busy = false;
    } catch (error) {
      console.error(error);
      clearInterval(silenceCheck);
      audioContext?.close().catch(console.error);
      audioContext = null;
      stream?.getTracks().forEach(track => track.stop());
      busy = false;
      button.disabled = false;
      button.textContent = 'Record';
      button.setAttribute('aria-pressed', 'false');
      status.textContent = 'Recording could not start. Check microphone permission and try again.';
      updateControls();
    }
  }
  practiceButton.onclick = startRecording;

  window.addEventListener('beforeunload', event => {
    if (recorder || busy || pending) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
})();
