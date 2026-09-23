(() => {
  const button = document.querySelector('#service-record-button');
  const endpoint = `${supabaseUrl}/rest/v1/bradymenu_service_recordings_v1`;
  let recorder = null;
  let busy = false;
  let timer;
  let silenceCheck;
  let audioContext;
  let pending = null;

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
  window.stopServiceRecording = stop;

  button.onclick = async () => {
    if (recorder?.state === 'recording') { stop(); return; }
    if (busy) return;
    if (pending) { await savePending(); return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      return;
    }
    busy = true;
    button.disabled = true;
    button.textContent = 'Stop Recording';
    button.setAttribute('aria-pressed', 'true');
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
      const item = { id: crypto.randomUUID(), title: window.servicePassageTitle, start: new Date().toISOString() };
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
    }
  };

  window.addEventListener('beforeunload', event => {
    if (recorder || busy || pending) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
})();
