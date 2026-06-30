import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('widget authoring navigation guidance', () => {
    it('documents the shared navigation contract in the template and authoring guide', () => {
        const currentFilePath = fileURLToPath(import.meta.url);
        const repoRoot = path.resolve(path.dirname(currentFilePath), '../../..');
        const templateSource = readFileSync(
            path.join(repoRoot, '.agent/skills/interfaz-widget/assets/NewWidgetTemplate.tsx'),
            'utf8',
        );
        const authoringSource = readFileSync(
            path.join(repoRoot, 'hmi-app/src/widgets/WIDGET_AUTHORING.md'),
            'utf8',
        );

        expect(templateSource).toContain('navigationTargetDashboardId');
        expect(templateSource).toContain('WidgetRenderer');
        expect(authoringSource).toContain('navigationTargetDashboardId');
        expect(authoringSource).toContain('Navegación');
    });
});
