export interface StorageProvider {
  getUploadUrl(filename: string, contentType: string): Promise<{ url: string, key: string, requiredHeaders?: Record<string, string> }>;
  getDownloadUrl(key: string): Promise<{ url: string }>;
}

export class YouwareStorageProvider implements StorageProvider {
  async getUploadUrl(filename: string, contentType: string) {
    const response = await fetch('https://storage.youware.me/presign/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: `uploads/${Date.now()}-${filename}`,
        contentType: contentType || 'application/octet-stream'
      })
    });
    return await response.json();
  }

  async getDownloadUrl(key: string) {
    const response = await fetch('https://storage.youware.me/presign/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key })
    });
    return await response.json();
  }
}

// Factory or singleton
export const storage = new YouwareStorageProvider();
