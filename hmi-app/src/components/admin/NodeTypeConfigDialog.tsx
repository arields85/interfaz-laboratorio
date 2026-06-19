import { useEffect, useMemo, useState } from 'react';
import { Folder, FolderOpen, Plus, Square, Trash2 } from 'lucide-react';
import type { NodeTypeDefinition } from '../../services/NodeTypeStorageService';
import { AVAILABLE_NODE_ICONS, DEFAULT_ICON_KEY, NODE_TYPE_COLOR_OPTIONS } from '../../utils/nodeTypeIcons';
import {
    ADMIN_SIDEBAR_HINT_CLS,
    ADMIN_SIDEBAR_INPUT_CLS,
    ADMIN_SIDEBAR_LABEL_CLS,
} from './adminSidebarStyles';
import AdminActionButton from './AdminActionButton';
import AdminDestructiveDialog from './AdminDestructiveDialog';
import AdminDialog from './AdminDialog';
import AdminSelect from './AdminSelect';

interface EditableNodeTypeDefinition extends NodeTypeDefinition {
    isNew?: boolean;
}

interface NodeTypeConfigDialogProps {
    open: boolean;
    onClose: () => void;
    nodeTypes: NodeTypeDefinition[];
    onSave: (types: NodeTypeDefinition[]) => void;
    nodeCountByType: Record<string, number>;
}

const INDUSTRIAL_TERMS_ES_EN: Record<string, string> = {
    planta: 'plant',
    'área': 'area',
    sector: 'sector',
    'línea': 'line',
    celda: 'cell',
    box: 'box',
    equipo: 'equipment',
    carpeta: 'folder',
    grupo: 'group',
    mezclador: 'mixer',
    mezcladora: 'mixer',
    'válvula': 'valve',
    bomba: 'pump',
    tanque: 'tank',
    compresor: 'compressor',
    comprimidora: 'compressor',
    caldera: 'boiler',
    horno: 'furnace',
    reactor: 'reactor',
    torre: 'tower',
    filtro: 'filter',
    separador: 'separator',
    intercambiador: 'exchanger',
    condensador: 'condenser',
    evaporador: 'evaporator',
    secador: 'dryer',
    molino: 'mill',
    trituradora: 'crusher',
    centrifuga: 'centrifuge',
    'centrífuga': 'centrifuge',
    transportador: 'conveyor',
    silo: 'silo',
    tolva: 'hopper',
    agitador: 'agitator',
    dosificador: 'doser',
    envasadora: 'packer',
    paila: 'pan',
    recubrimiento: 'coating',
    'almacén': 'warehouse',
    'depósito': 'depot',
    generador: 'generator',
    motor: 'motor',
    turbina: 'turbine',
    sensor: 'sensor',
    actuador: 'actuator',
    panel: 'panel',
    tablero: 'board',
    'subestación': 'substation',
    zona: 'zone',
    'módulo': 'module',
    unidad: 'unit',
    sistema: 'system',
    subsistema: 'subsystem',
    proceso: 'process',
};

function getColorLabel(color: string): string {
    return color.replace('text-', '').replaceAll('-', ' ');
}

function normalizeNodeTypeTerm(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
}

function slugifyNodeTypeKey(value: string): string {
    return normalizeNodeTypeTerm(value)
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function generateNodeTypeKey(label: string, existingKeys: string[]): string {
    const trimmedLabel = label.trim();
    const normalizedLabel = normalizeNodeTypeTerm(trimmedLabel);
    const translated = INDUSTRIAL_TERMS_ES_EN[normalizedLabel] ?? INDUSTRIAL_TERMS_ES_EN[trimmedLabel.toLowerCase()];
    const baseKey = slugifyNodeTypeKey(translated ?? trimmedLabel);

    if (!baseKey) return '';

    const usedKeys = new Set(existingKeys.filter(Boolean));
    let key = baseKey;
    let counter = 1;

    while (usedKeys.has(key)) {
        key = `${baseKey}-${counter}`;
        counter += 1;
    }

    return key;
}

function buildNewNodeType(): EditableNodeTypeDefinition {
    return {
        key: '',
        label: '',
        icon: DEFAULT_ICON_KEY,
        color: AVAILABLE_NODE_ICONS[DEFAULT_ICON_KEY]?.defaultColor ?? 'text-industrial-muted',
        isNew: true,
    };
}

function getReservedKeys(draftTypes: EditableNodeTypeDefinition[], currentIndex?: number): string[] {
    return draftTypes.flatMap((type, index) => {
        if (index === currentIndex || !type.key.trim()) return [];
        return [type.key.trim()];
    });
}

function buildSanitizedTypes(draftTypes: EditableNodeTypeDefinition[]): NodeTypeDefinition[] {
    const usedKeys = new Set(
        draftTypes
            .filter((type) => !type.isNew)
            .map((type) => type.key.trim())
            .filter(Boolean),
    );

    return draftTypes.map((type) => {
        const label = type.label.trim();
        const key = type.isNew
            ? generateNodeTypeKey(label, Array.from(usedKeys))
            : type.key.trim();

        if (type.isNew && key) {
            usedKeys.add(key);
        }

        return {
            key,
            label,
            icon: type.icon || DEFAULT_ICON_KEY,
            color: type.color || AVAILABLE_NODE_ICONS[type.icon]?.defaultColor || 'text-industrial-muted',
        };
    });
}

export default function NodeTypeConfigDialog({
    open,
    onClose,
    nodeTypes,
    onSave,
    nodeCountByType,
}: NodeTypeConfigDialogProps) {
    const [draftTypes, setDraftTypes] = useState<EditableNodeTypeDefinition[]>(() => nodeTypes.map((type) => ({ ...type, isNew: false })));
    const [pendingDeleteState, setPendingDeleteState] = useState<{ key: string; version: number } | null>(null);
    const [dialogSyncVersion, setDialogSyncVersion] = useState(0);

    const activePendingDeleteKey = open && pendingDeleteState?.version === dialogSyncVersion
        ? pendingDeleteState.key
        : null;

    const pendingDeleteType = useMemo(
        () => draftTypes.find((type) => type.key === activePendingDeleteKey) ?? null,
        [activePendingDeleteKey, draftTypes],
    );
    const pendingDeleteCount = pendingDeleteType ? (nodeCountByType[pendingDeleteType.key] ?? 0) : 0;

    useEffect(() => {
        if (!open) return;

        /* eslint-disable react-hooks/set-state-in-effect -- opening or prop-resyncing the dialog must refresh local draft state and invalidate stale destructive confirmation state in the same sync pass. */
        setDraftTypes(nodeTypes.map((type) => ({ ...type, isNew: false })));
        setDialogSyncVersion((current) => current + 1);
        /* eslint-enable react-hooks/set-state-in-effect */
    }, [nodeTypes, open]);

    const sanitizedTypes = useMemo(() => buildSanitizedTypes(draftTypes), [draftTypes]);

    const hasDuplicateKeys = useMemo(() => {
        const keys = sanitizedTypes.map((type) => type.key).filter(Boolean);
        return new Set(keys).size !== keys.length;
    }, [sanitizedTypes]);

    const hasInvalidRows = draftTypes.some((type) => {
        const hasKey = type.isNew ? Boolean(type.label.trim()) : Boolean(type.key.trim());
        return !hasKey || !type.label.trim() || !type.icon || !type.color;
    });

    const handleUpdateType = (index: number, partial: Partial<EditableNodeTypeDefinition>) => {
        setDraftTypes((current) => current.map((type, rowIndex) => {
            if (rowIndex !== index) return type;

            const nextType = { ...type, ...partial };

            if (partial.label !== undefined && type.isNew) {
                nextType.key = '';
            }

            if (partial.icon !== undefined && !partial.color) {
                nextType.color = nextType.color || AVAILABLE_NODE_ICONS[partial.icon]?.defaultColor || 'text-industrial-muted';
            }

            return nextType;
        }));
    };

    const handleLabelBlur = (index: number) => {
        setDraftTypes((current) => current.map((type, rowIndex) => {
            if (rowIndex !== index || !type.isNew || !type.label.trim()) return type;

            return {
                ...type,
                key: generateNodeTypeKey(type.label, getReservedKeys(current, index)),
            };
        }));
    };

    const getDisplayKey = (type: EditableNodeTypeDefinition, index: number): string => {
        if (!type.isNew) return type.key;
        if (!type.label.trim()) return 'se genera al guardar';
        return generateNodeTypeKey(type.label, getReservedKeys(draftTypes, index));
    };

    const handleRequestDelete = (type: EditableNodeTypeDefinition) => {
        const usageCount = nodeCountByType[type.key] ?? 0;

        if (usageCount > 0) {
            setPendingDeleteState({ key: type.key, version: dialogSyncVersion });
            return;
        }

        setDraftTypes((current) => current.filter((item) => item !== type));
    };

    const handleConfirmDelete = () => {
        if (!activePendingDeleteKey) return;

        setDraftTypes((current) => current.filter((type) => type.key !== activePendingDeleteKey));
        setPendingDeleteState(null);
    };

    const handleSave = () => {
        onSave(sanitizedTypes);
    };

    const iconOptions = Object.entries(AVAILABLE_NODE_ICONS).map(([key, definition]) => {
        const Icon = definition.component;
        const iconClassName = definition.defaultColor;

        return {
            value: key,
            label: key,
            icon: key === 'folder'
                ? <Folder size={14} className={`shrink-0 ${iconClassName}`} />
                : <Icon size={14} className={`shrink-0 ${iconClassName}`} />,
        };
    });

    const colorOptions = NODE_TYPE_COLOR_OPTIONS.map((color) => ({
        value: color,
        label: getColorLabel(color),
        icon: <span className={`block h-2.5 w-2.5 rounded-full bg-current ${color}`} />,
    }));

    return (
        <>
            <AdminDialog
                open={open}
                title="CONFIGURAR TIPOS DE NODO"
                onClose={onClose}
                actions={(
                    <>
                        <AdminActionButton variant="secondary" onClick={onClose}>Cancelar</AdminActionButton>
                        <AdminActionButton
                            variant="primary"
                            onClick={handleSave}
                            disabled={draftTypes.length === 0 || hasInvalidRows || hasDuplicateKeys}
                        >
                            Guardar cambios
                        </AdminActionButton>
                    </>
                )}
            >
                <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1 hmi-scrollbar">
                    {draftTypes.map((type, index) => {
                        const iconDefinition = AVAILABLE_NODE_ICONS[type.icon] ?? AVAILABLE_NODE_ICONS[DEFAULT_ICON_KEY];
                        const Icon = iconDefinition?.component ?? Square;
                        const previewColor = type.color || iconDefinition?.defaultColor || 'text-industrial-muted';
                        const usageCount = nodeCountByType[type.key] ?? 0;
                        const previewIcon = type.icon === 'folder'
                            ? <FolderOpen size={18} className={`shrink-0 ${previewColor}`} />
                            : <Icon size={18} className={`shrink-0 ${previewColor}`} />;

                        return (
                            <div key={`${type.key || 'new'}-${index}`} className="space-y-3 rounded-lg border border-white/10 bg-white/[0.03] p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-black/20">
                                            {previewIcon}
                                        </div>
                                        <div>
                                            <p className="uppercase text-white">{type.label || 'Nuevo tipo'}</p>
                                            <p className={`font-mono ${ADMIN_SIDEBAR_HINT_CLS}`}>key: {getDisplayKey(type, index)}</p>
                                        </div>
                                    </div>

                                    <AdminActionButton
                                        variant="secondary"
                                        className="px-3"
                                        onClick={() => handleRequestDelete(type)}
                                    >
                                        <Trash2 size={12} /> Eliminar
                                    </AdminActionButton>
                                </div>

                                <div className="grid gap-3 md:grid-cols-2">
                                    <div>
                                        <label className={`mb-1.5 block ${ADMIN_SIDEBAR_LABEL_CLS} w-auto`}>Label</label>
                                        <input
                                            value={type.label}
                                            onChange={(event) => handleUpdateType(index, { label: event.target.value })}
                                            onBlur={() => handleLabelBlur(index)}
                                            className={`${ADMIN_SIDEBAR_INPUT_CLS} px-3 py-2`}
                                        />
                                        <p className={`mt-1 font-mono ${ADMIN_SIDEBAR_HINT_CLS}`}>
                                            key: {getDisplayKey(type, index)}
                                        </p>
                                    </div>

                                    <div>
                                        <label className={`mb-1.5 block ${ADMIN_SIDEBAR_LABEL_CLS} w-auto`}>Ícono</label>
                                        <AdminSelect
                                            value={type.icon}
                                            onChange={(value) => handleUpdateType(index, {
                                                icon: value,
                                                color: type.color || AVAILABLE_NODE_ICONS[value]?.defaultColor,
                                            })}
                                            options={iconOptions}
                                        />
                                    </div>

                                    <div>
                                        <label className={`mb-1.5 block ${ADMIN_SIDEBAR_LABEL_CLS} w-auto`}>Color</label>
                                        <AdminSelect
                                            value={type.color}
                                            onChange={(value) => handleUpdateType(index, { color: value })}
                                            options={colorOptions}
                                        />
                                    </div>
                                </div>

                                {usageCount > 0 && (
                                    <p className="text-status-warning">
                                        Este tipo está asignado a {usageCount} nodo{usageCount !== 1 ? 's' : ''}. Si lo eliminás, esos nodos conservarán la key pero quedarán sin definición visual explícita.
                                    </p>
                                )}
                            </div>
                        );
                    })}

                    <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-white/10 bg-black/10 p-4">
                        <div>
                            <p className="uppercase text-white">Agregar tipo</p>
                            <p className="text-industrial-muted">Creá una nueva definición editable por el admin.</p>
                        </div>
                        <AdminActionButton variant="primary" onClick={() => setDraftTypes((current) => [...current, buildNewNodeType()])}>
                            <Plus size={12} /> Agregar tipo
                        </AdminActionButton>
                    </div>

                    {(hasInvalidRows || hasDuplicateKeys) && (
                        <p className="text-status-warning">
                            Revisá los tipos antes de guardar: cada fila necesita label, ícono y color, y las keys internas deben seguir siendo únicas.
                        </p>
                    )}
                </div>
            </AdminDialog>

            <AdminDestructiveDialog
                open={Boolean(pendingDeleteType)}
                title="TIPO DE NODO EN USO"
                onClose={() => setPendingDeleteState(null)}
                onConfirm={handleConfirmDelete}
                warningMessage="Este tipo está siendo usado por nodos de la jerarquía. Si seguís adelante, esos nodos mantendrán su key actual pero perderán la definición administrable de label, ícono y color."
                affectedLabel="Tipo afectado"
                affectedItems={pendingDeleteType ? [{ id: pendingDeleteType.key, name: `${pendingDeleteType.label} · ${pendingDeleteCount} nodo(s)` }] : []}
                confirmMessage="¿Querés eliminar el tipo igualmente?"
                actionLabel="Eliminar igual"
            />
        </>
    );
}
