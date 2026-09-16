export async function convertBlobToWav(blob: Blob): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = new AudioContext({ sampleRate: 16000 });
  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    return encodePcmChunksToWavBlob([audioBuffer.getChannelData(0)], audioBuffer.sampleRate);
  } finally {
    await audioContext.close();
  }
}

/**
 * 将 PCM 数据块编码为 16bit 单声道 WAV 的 Blob。
 *
 * 用于 WebAudio 实时采集场景：采集过程中已持有原始浮点 PCM，
 * 直接编码出 WAV 可省掉「录成容器格式 → 解码 → 再编码」的往返开销，
 * 也让「边说边识别」能对任意时长的音频片段即时生成可提交的音频。
 *
 * @param chunks     PCM 数据块列表（每块为 -1~1 的浮点样本，按时间先后排列）
 * @param sampleRate 采样率，必须与采集时一致（传错会让离线识别结果变成乱码）
 */
export function encodePcmChunksToWavBlob(
  chunks: Float32Array[],
  sampleRate: number,
): Blob {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;

  let numSamples = 0;
  for (const chunk of chunks) numSamples += chunk.length;

  const dataSize = numSamples * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, totalSize - 8, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, (sampleRate * numChannels * bitsPerSample) / 8, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = headerSize;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const sample = Math.max(-1, Math.min(1, chunk[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
