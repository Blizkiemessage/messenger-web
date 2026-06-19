/**
 * composer/helpers.ts — pure helpers for the Composer (no React, no hooks).
 */

export function fmt(sec: number): string {
  if (!isFinite(sec) || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Downsample raw amplitude samples (0–1 floats) into N bars (integers 8–100).
// Uses RMS per chunk so loud transients don't dominate perceived loudness.
export function computeWaveformBars(rawAmps: number[], n = 50): number[] {
  if (rawAmps.length === 0) return new Array(n).fill(20);
  const step = rawAmps.length / n;
  const bars: number[] = [];
  for (let i = 0; i < n; i++) {
    const start = Math.floor(i * step);
    const end   = Math.max(start + 1, Math.floor((i + 1) * step));
    const chunk = rawAmps.slice(start, end);
    const rms   = Math.sqrt(chunk.reduce((s, v) => s + v * v, 0) / chunk.length);
    bars.push(rms);
  }
  const maxVal = Math.max(...bars, 0.001);
  return bars.map(b => Math.round(8 + (b / maxVal) * 92));
}

export function getFileCategory(name: string): { color: string; label: string } {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['jpg','jpeg','png','gif','webp','svg','heic','bmp','tiff'].includes(ext)) return { color: '#9b59b6', label: ext.toUpperCase() };
  if (ext === 'pdf')  return { color: '#e74c3c', label: 'PDF' };
  if (['doc','docx','odt'].includes(ext))  return { color: '#2980b9', label: 'DOC' };
  if (['xls','xlsx','ods','csv'].includes(ext)) return { color: '#27ae60', label: 'XLS' };
  if (['ppt','pptx','odp'].includes(ext))  return { color: '#e67e22', label: 'PPT' };
  if (['txt','md','rtf'].includes(ext))    return { color: '#7f8c8d', label: 'TXT' };
  if (['js','ts','jsx','tsx','py','java','c','cpp','cs','go','rb','php','html','css','json','xml','yaml','yml','sh','sql','swift','kt','rs'].includes(ext)) return { color: '#16a085', label: ext.toUpperCase() };
  if (['zip','rar','7z','tar','gz','bz2'].includes(ext)) return { color: '#f39c12', label: 'ZIP' };
  if (['mp3','wav','aac','flac','ogg','m4a'].includes(ext)) return { color: '#e91e63', label: 'AUD' };
  if (['mp4','avi','mov','mkv','wmv','webm'].includes(ext)) return { color: '#c0392b', label: 'VID' };
  return { color: '#95a5a6', label: ext.toUpperCase() || 'FILE' };
}
