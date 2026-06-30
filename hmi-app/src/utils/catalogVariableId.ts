export function buildCatalogVariableId(name: string, unit: string): string {
    const normalizedName = slugifyCatalogVariableSegment(name);
    const normalizedUnit = slugifyCatalogVariableSegment(unit);
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 6);

    return `cv-${normalizedName}-${normalizedUnit}-${timestamp}-${random}`;
}

function slugifyCatalogVariableSegment(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        || 'variable';
}
