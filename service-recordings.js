(() => {
  const practiceButton = document.querySelector('#service-record-button');
  const exampleButton = document.querySelector('#service-example-button');
  const playButton = document.querySelector('#service-play-button');
  const playbackPanel = document.querySelector('#service-playback');
  const status = document.querySelector('#service-playback-status');
  const exampleIds = {
    p: '93f616e9-04a7-4954-a7d4-4177da657bcb',
    g3eb74f277b9_0_9: '91b7e099-502a-49b1-8ddf-d70e45253b72',
    g3eb74f277b9_0_22: 'a8ef17bc-8fc6-473a-bcee-baf673d0a615',
    g3eb74f277b9_0_32: '0c06585c-66aa-467c-9c71-26bfc4f26085',
    g3eb74f277b9_0_61: '07b597b3-553d-4075-bf32-2e585b01d29d'
  };
  let exampleId = null;
  const audio = new Audio();
  let button = practiceButton;
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
    practiceButton.disabled = active && button !== practiceButton;
    exampleButton.disabled = active && button !== exampleButton;
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
      status.textContent = item ? '' : 'Record an example to enable Play.';
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
      if (pending.example && pending.id === exampleId) {
        ++loadVersion;
        audio.src = `data:${pending.blob.type};base64,${await asBase64(pending.blob)}`;
        exampleAvailable = true;
        status.textContent = 'Example saved.';
      }
      pending = null;
      button.textContent = button === exampleButton ? 'Record example' : 'Record';
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

  async function startRecording(target) {
    if (target !== button && (recorder || busy || pending)) return;
    button = target;
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
    const example = button === exampleButton;
    const item = { id: example ? exampleId : crypto.randomUUID(), title: example ? `${window.servicePassageTitle} — playback example` : window.servicePassageTitle, start: new Date().toISOString(), example };
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
        button.textContent = example ? 'Record example' : 'Record';
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
      button.textContent = button === exampleButton ? 'Record example' : 'Record';
      button.setAttribute('aria-pressed', 'false');
      status.textContent = 'Recording could not start. Check microphone permission and try again.';
      updateControls();
    }
  }
  practiceButton.onclick = () => startRecording(practiceButton);
  exampleButton.onclick = () => startRecording(exampleButton);

  window.addEventListener('beforeunload', event => {
    if (recorder || busy || pending) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
})();
