import apiClient from './client';

/**
 * Request a full GDPR data export and trigger a browser download.
 * The backend streams a ZIP file; we receive it as a Blob and create a
 * temporary <a> to trigger the "Save as" dialog — Bearer auth is preserved
 * because we go through the axios client instead of a plain href navigation.
 */
export async function downloadMyData(): Promise<void> {
  const response = await apiClient.get('/export/my-data', {
    responseType: 'blob',
    timeout: 120_000, // large chat histories can take a while to pack
  });

  const blob = new Blob([response.data as BlobPart], { type: 'application/zip' });
  const url  = URL.createObjectURL(blob);

  const a        = document.createElement('a');
  a.href         = url;
  a.download     = `blizkie-export-${new Date().toISOString().slice(0, 10)}.zip`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
