// Shared helpers for portable JSON files (dashboard and connection exports).

export function formatPortableTimestamp(value: Date): string {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const day = String(value.getUTCDate()).padStart(2, '0');
    const hours = String(value.getUTCHours()).padStart(2, '0');
    const minutes = String(value.getUTCMinutes()).padStart(2, '0');

    return `${year}${month}${day}-${hours}${minutes}`;
}

export function downloadJsonFile(fileName: string, json: string): void {
    const downloadUrl = URL.createObjectURL(new Blob([json], { type: 'application/json' }));

    try {
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = fileName;
        link.click();
    } finally {
        URL.revokeObjectURL(downloadUrl);
    }
}
