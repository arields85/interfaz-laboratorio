import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('leda-orb vendor', () => {
    it('remains byte-identical to the approved demo artifact', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/vendor/leda-orb.js'));

        expect(createHash('sha256').update(source).digest('hex')).toBe(
            '22256b0a7a45aa15976c6c9648eef2b8fb8e50b38c59720c06fe6a385de0294a',
        );
    });
});
