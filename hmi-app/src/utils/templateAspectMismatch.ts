import type { DashboardAspect } from '../domain/admin.types';

export function buildTemplateAspectMismatchMessage(
    templateAspect: DashboardAspect,
    dashboardAspect: DashboardAspect,
): string {
    return `Este template es ${templateAspect}, no coincide con el aspect ${dashboardAspect} del dashboard. Cambie el aspect del dashboard o elija otro template.`;
}

interface TemplateAspectMismatchErrorOptions {
    templateAspect: DashboardAspect;
    dashboardAspect: DashboardAspect;
    message?: string;
}

export class TemplateAspectMismatchError extends Error {
    public readonly templateAspect: DashboardAspect;
    public readonly dashboardAspect: DashboardAspect;

    public constructor({ templateAspect, dashboardAspect, message }: TemplateAspectMismatchErrorOptions) {
        super(message ?? buildTemplateAspectMismatchMessage(templateAspect, dashboardAspect));
        this.name = 'TemplateAspectMismatchError';
        this.templateAspect = templateAspect;
        this.dashboardAspect = dashboardAspect;
    }
}
