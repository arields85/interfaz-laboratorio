import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MetricCardWidgetConfig } from '../../domain/admin.types';
import MetricWidget from './MetricWidget';

const widget = {
    id: 'metric-presentation', type: 'metric-card', title: 'Power', position: { x: 0, y: 0 }, size: { w: 2, h: 2 },
    binding: { mode: 'real_variable', assetId: 'missing-asset', unit: 'kW' }, displayOptions: {},
} as MetricCardWidgetConfig;

describe('MetricWidget presentation payload', () => {
    it('renders controller data instead of resolving the missing equipment map', () => {
        render(<MetricWidget widget={widget} equipmentMap={new Map()} presentationData={{ binding: { value: 42, unit: 'kW', status: 'normal', source: 'real' }, value: 42, unit: 'kW', status: 'normal', source: 'real' }} />);
        expect(screen.getByText('Power')).toBeInTheDocument();
        expect(screen.getByText('42')).toBeInTheDocument();
        expect(screen.getByText('kW')).toBeInTheDocument();
    });

    it('preserves controller no-data status without inventing a value', () => {
        render(<MetricWidget widget={widget} equipmentMap={new Map()} presentationData={{ binding: { value: null, unit: 'kW', status: 'no-data', source: 'error' }, value: null, unit: 'kW', status: 'no-data', source: 'error' }} />);
        expect(screen.getByText('Error de lectura')).toBeInTheDocument();
        expect(screen.queryByText('42')).not.toBeInTheDocument();
    });
});
