import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Loader2, Network, ChevronRight, LayoutDashboard, Search,
    ExternalLink, Link2, Plus, Edit2, Trash2, FolderSymlink, Check, SearchX
} from 'lucide-react';
import type { HierarchyNode, NodeType } from '../../domain/admin.types';
import type { Dashboard } from '../../domain/admin.types';
import AdminWorkspaceLayout from '../../components/admin/AdminWorkspaceLayout';
import HierarchyActionsRail from '../../components/admin/HierarchyActionsRail';
import { hierarchyStorage } from '../../services/HierarchyStorageService';
import { dashboardStorage } from '../../services/DashboardStorageService';
import { nodeTypeStorage, type NodeTypeDefinition } from '../../services/NodeTypeStorageService';
import {
    buildTree,
    filterTreeByName,
    findNodeInTree,
    getAncestors,
    treeContainsNodeId,
    type HierarchyNodeWithChildren,
} from '../../utils/hierarchyTree';
import { applyNodeTypeLabels, buildNodeTypeLabels, resolveTypeLabel } from '../../utils/nodeTypeLabels';
import HierarchyTree from '../../components/admin/HierarchyTree';
import {
    ADMIN_SIDEBAR_INPUT_CLS,
    ADMIN_SIDEBAR_SECTION_CLS,
    ADMIN_SIDEBAR_SECTION_HEADER_CLS,
    ADMIN_SIDEBAR_LABEL_CLS,
} from '../../components/admin/adminSidebarStyles';
import AdminEmptyState from '../../components/admin/AdminEmptyState';
import AdminDialog from '../../components/admin/AdminDialog';
import AdminActionButton from '../../components/admin/AdminActionButton';
import AdminSelect from '../../components/admin/AdminSelect';
import AdminTag from '../../components/admin/AdminTag';
import NodeTypeConfigDialog from '../../components/admin/NodeTypeConfigDialog';
import { HIERARCHY_EXPANDED_STORAGE_KEY } from '../../utils/legacyStorageCleanup';

// =============================================================================
// HierarchyPage
// Módulo de Jerarquía de Planta dentro del Modo Administrador.
// Especificación Funcional Modo Admin §6 / §14
// =============================================================================

function NodeDetailPanel({
    node,
    dashboards,
    allNodes,
    nodeTypeLabels,
    onUpdate,
    onDashboardLinkChange,
    onCreateDashboard,
}: {
    node: HierarchyNodeWithChildren | null;
    dashboards: Dashboard[];
    allNodes: HierarchyNode[];
    nodeTypeLabels: Record<string, string>;
    onUpdate: (id: string, partial: Partial<Omit<HierarchyNode, 'id' | 'parentId'>>) => void;
    onDashboardLinkChange: (nodeId: string, nextDashboardId?: string) => Promise<void>;
    onCreateDashboard: (nodeId: string) => Promise<void>;
}) {
    const navigate = useNavigate();

    // Estados de UI locales
    const [isEditingName, setIsEditingName] = useState(false);
    const [editNameValue, setEditNameValue] = useState(() => node?.name ?? '');

    if (!node) {
        return (
            <div className="flex-1 px-8 py-6">
                <AdminEmptyState
                    icon={Network}
                    message="Seleccioná un nodo para ver y editar sus detalles"
                />
            </div>
        );
    }

    const hasChildren = node.children.length > 0;

    const handleSaveName = () => {
        if (editNameValue.trim() && editNameValue !== node.name) {
            onUpdate(node.id, { name: editNameValue.trim() });
        } else {
            setEditNameValue(node.name); // revert on empty
        }
        setIsEditingName(false);
    };

    const handleDashboardChange = (val: string) => {
        void onDashboardLinkChange(node.id, val === 'none' ? undefined : val);
    };

    const getDashboardDisplayName = (dashboard: Dashboard) => {
        const headerTitle = dashboard.headerConfig?.title?.trim();
        return headerTitle || dashboard.name;
    };

    const dashboardAssignments = new Map<string, string>();
    for (const otherNode of allNodes) {
        if (otherNode.id === node.id || !otherNode.linkedDashboardId) continue;
        if (!dashboardAssignments.has(otherNode.linkedDashboardId)) {
            dashboardAssignments.set(otherNode.linkedDashboardId, otherNode.name);
        }
    }

    const dashboardOptions = [
        { value: 'none', label: '-- Sin dashboard asignado --' },
        ...dashboards.map((dashboard) => {
            const linkedNodeName = dashboardAssignments.get(dashboard.id);
            const isLinkedToOtherNode = Boolean(linkedNodeName) && dashboard.id !== node.linkedDashboardId;

            return {
                value: dashboard.id,
                label: `${getDashboardDisplayName(dashboard)} ${dashboard.status === 'published' ? '(Público)' : '(Borrador)'}${isLinkedToOtherNode ? ` (Vinculado a ${linkedNodeName})` : ''}`,
                disabled: isLinkedToOtherNode,
            };
        }),
    ];

    return (
        <div className="h-full min-h-0 flex flex-col overflow-hidden relative">
            <div className="flex-1 min-h-0 overflow-y-auto p-8 hmi-scrollbar">
                {/* HEADER DEL NODO (RENOMBRABLE) */}
                <div className="flex items-start gap-4 mb-8">
                    <div className="w-full">
                        <div className="flex items-center gap-3 mb-1 w-full max-w-xl">
                            {isEditingName ? (
                                <div className="flex items-center gap-2 w-full">
                                    <input 
                                        autoFocus
                                        value={editNameValue}
                                        onChange={e => setEditNameValue(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && handleSaveName()}
                                        onBlur={handleSaveName}
                                        className={`${ADMIN_SIDEBAR_INPUT_CLS} w-full border-admin-accent/50 bg-black/50 py-1`}
                                    />
                                    <button onClick={handleSaveName} className="p-2 text-admin-accent hover:bg-white/10 rounded">
                                        <Check size={20} />
                                    </button>
                                </div>
                            ) : (
                                <div
                                    className="flex items-center gap-3 group cursor-pointer"
                                    onClick={() => {
                                        setEditNameValue(node.name);
                                        setIsEditingName(true);
                                    }}
                                >
                                    <h1 className="text-white group-hover:text-admin-accent transition-colors">
                                        {node.name}
                                    </h1>
                                    <Edit2 size={14} className="text-white/20 group-hover:text-admin-accent transition-colors" />
                                </div>
                            )}
                        </div>
                        <p className="text-industrial-muted flex items-center gap-2">
                            <span className="font-mono">id: {node.id}</span>
                            <AdminTag label={resolveTypeLabel(node.type, nodeTypeLabels)} variant="muted" />
                        </p>
                    </div>
                </div>

                {/* GRID DE PROPIEDADES */}
                <div className="grid grid-cols-1 gap-4 max-w-2xl">

                    {/* Dashboard vinculado (EDITABLE) */}
                    <section className={`${ADMIN_SIDEBAR_SECTION_CLS} flex items-start gap-3 p-4`}>
                        <LayoutDashboard size={16} className={`${node.linkedDashboardId ? 'text-admin-accent' : 'text-industrial-muted'} mt-0.5 shrink-0`} />
                        <div className="relative w-full flex-1">
                            <p className={ADMIN_SIDEBAR_SECTION_HEADER_CLS}>
                                Dashboard vinculado
                            </p>
                            
                            <AdminSelect
                                value={node.linkedDashboardId || 'none'}
                                onChange={handleDashboardChange}
                                options={dashboardOptions}
                                className="mb-3"
                            />

                            <div className="flex items-center gap-2">
                                <AdminActionButton
                                    onClick={() => navigate(`/admin/builder/${node.linkedDashboardId}`)}
                                    variant="primary"
                                    disabled={!node.linkedDashboardId}
                                >
                                    <ExternalLink size={12} /> Editar
                                </AdminActionButton>

                                <AdminActionButton
                                    onClick={() => void onCreateDashboard(node.id)}
                                    variant="primary"
                                    disabled={Boolean(node.linkedDashboardId)}
                                >
                                    <Plus size={12} /> Crear nuevo dashboard
                                </AdminActionButton>
                            </div>
                        </div>
                    </section>

                    {/* Activo asociado (Solo lectura V1) */}
                    <section className={`${ADMIN_SIDEBAR_SECTION_CLS} flex items-start gap-3 p-4`}>
                        <Link2 size={16} className="mt-0.5 shrink-0 text-industrial-muted" />
                        <div className="flex-1">
                            <p className={ADMIN_SIDEBAR_SECTION_HEADER_CLS}>
                                Activo IoT asociado
                            </p>
                            <input 
                                disabled
                                value={node.linkedAssetId || 'Ninguno (Solo lectura en V1)'}
                                className={`${ADMIN_SIDEBAR_INPUT_CLS} cursor-not-allowed border-white/5 px-3 py-2 text-industrial-muted`}
                            />
                        </div>
                    </section>

                    {/* Sub-nodos Info */}
                    {hasChildren && (
                        <section className={`${ADMIN_SIDEBAR_SECTION_CLS} flex items-start gap-3 p-4`}>
                            <Network size={16} className="mt-0.5 shrink-0 text-industrial-muted" />
                            <div>
                                <p className={`${ADMIN_SIDEBAR_SECTION_HEADER_CLS} mb-1`}>
                                    Jerarquía Descendente
                                </p>
                                <p className="text-white">
                                    Contiene {node.children.length} nodo{node.children.length !== 1 ? 's' : ''} directos.
                                </p>
                            </div>
                        </section>
                    )}
                </div>
            </div>

        </div>
    );
}

// ---- Página principal ----
export default function HierarchyPage() {
    const navigate = useNavigate();
    const [allNodes, setAllNodes] = useState<HierarchyNode[]>([]);
    const [dashboards, setDashboards] = useState<Dashboard[]>([]);
    const [nodeTypes, setNodeTypes] = useState<NodeTypeDefinition[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [showAddChildModal, setShowAddChildModal] = useState(false);
    const [newChildName, setNewChildName] = useState('');
    const [newChildType, setNewChildType] = useState<NodeType>('equipment');
    const [showMoveModal, setShowMoveModal] = useState(false);
    const [moveTargetId, setMoveTargetId] = useState('');
    const [showAddRootDialog, setShowAddRootDialog] = useState(false);
    const [addRootName, setAddRootName] = useState('');
    const [showRenameDialog, setShowRenameDialog] = useState(false);
    const [renameValue, setRenameValue] = useState('');
    const [deleteTargetNodeId, setDeleteTargetNodeId] = useState<string | null>(null);
    const [dialogMessage, setDialogMessage] = useState<string | null>(null);
    const [showNodeTypeConfigDialog, setShowNodeTypeConfigDialog] = useState(false);

    // Estado expandido/colapsado del árbol — persistido en localStorage
    const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(() => {
        try {
            const stored = localStorage.getItem(HIERARCHY_EXPANDED_STORAGE_KEY);
            if (stored) return new Set(JSON.parse(stored) as string[]);
        } catch { /* ignorar datos corruptos */ }
        return new Set<string>();
    });

    const handleToggleExpand = useCallback((nodeId: string) => {
        setExpandedNodeIds(prev => {
            const next = new Set(prev);
            if (next.has(nodeId)) {
                next.delete(nodeId);
            } else {
                next.add(nodeId);
            }
            localStorage.setItem(HIERARCHY_EXPANDED_STORAGE_KEY, JSON.stringify([...next]));
            return next;
        });
    }, []);

    const load = async () => {
        try {
            const [nodes, dashs, storedNodeTypes] = await Promise.all([
                hierarchyStorage.getNodes(),
                dashboardStorage.getDashboards(),
                nodeTypeStorage.getAll(),
            ]);
            setAllNodes(nodes);
            setDashboards(dashs);
            setNodeTypes(storedNodeTypes);
            applyNodeTypeLabels(storedNodeTypes);
        } catch (err) {
            console.error('Error cargando datos de jerarquía:', err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, []);

    const tree = useMemo(() => buildTree(allNodes), [allNodes]);
    const filteredTree = useMemo(() => filterTreeByName(tree, searchTerm), [tree, searchTerm]);
    const nodeTypeLabels = useMemo(() => buildNodeTypeLabels(nodeTypes), [nodeTypes]);
    const nodeCountByType = useMemo(() => allNodes.reduce<Record<string, number>>((acc, node) => {
        acc[node.type] = (acc[node.type] ?? 0) + 1;
        return acc;
    }, {}), [allNodes]);
    const nodeTypeOptions = useMemo(() => Object.entries(nodeTypeLabels).map(([value, label]) => ({
        value,
        label,
    })), [nodeTypeLabels]);
    
    // Obtenemos el selectedNode derivado
    const selectedNode = useMemo(() => {
        if (!selectedNodeId) return null;
        return findNodeInTree(tree, selectedNodeId);
    }, [selectedNodeId, tree]);
    const selectedNodeBreadcrumbs = useMemo(
        () => (selectedNode ? getAncestors(selectedNode.id, allNodes) : []),
        [selectedNode, allNodes]
    );

    useEffect(() => {
        if (!selectedNodeId || !searchTerm.trim()) {
            return;
        }

        if (!treeContainsNodeId(filteredTree, selectedNodeId)) {
            setSelectedNodeId(null);
        }
    }, [filteredTree, searchTerm, selectedNodeId]);

    // Handlers CRUD
    const handleAddRoot = () => {
        setAddRootName('');
        setShowAddRootDialog(true);
    };

    const handleConfirmAddRoot = async () => {
        if (!addRootName.trim()) return;
        await hierarchyStorage.createNode(addRootName.trim(), 'plant', null);
        setShowAddRootDialog(false);
        setAddRootName('');
        await load();
    };

    const handleUpdateNode = async (id: string, partial: Partial<Omit<HierarchyNode, 'id' | 'parentId'>>) => {
        await hierarchyStorage.updateNode(id, partial);
        await load();
    };

    const handleDashboardLinkChange = async (nodeId: string, nextDashboardId?: string) => {
        const currentNode = allNodes.find((node) => node.id === nodeId);
        if (!currentNode) return;

        const previousDashboardId = currentNode.linkedDashboardId;

        await hierarchyStorage.updateNode(nodeId, { linkedDashboardId: nextDashboardId });

        if (previousDashboardId && previousDashboardId !== nextDashboardId) {
            const previousDashboard = await dashboardStorage.getDashboard(previousDashboardId);
            if (previousDashboard?.ownerNodeId === nodeId) {
                await dashboardStorage.saveDashboard({
                    ...previousDashboard,
                    ownerNodeId: undefined,
                    // Sin nodo asignado no puede estar publicado
                    status: 'draft',
                    publishedSnapshot: undefined,
                });
            }
        }

        if (nextDashboardId) {
            const nextDashboard = await dashboardStorage.getDashboard(nextDashboardId);
            if (nextDashboard && nextDashboard.ownerNodeId !== nodeId) {
                await dashboardStorage.saveDashboard({
                    ...nextDashboard,
                    ownerNodeId: nodeId,
                });
            }
        }

        await load();
    };

    const handleDeleteNode = (id: string) => {
        setDeleteTargetNodeId(id);
    };

    const handleConfirmDeleteNode = async () => {
        if (!deleteTargetNodeId) return;
        const targetId = deleteTargetNodeId;
        setDeleteTargetNodeId(null);

        const success = await hierarchyStorage.deleteNode(targetId);
        if (!success) {
            setDialogMessage('No se puede eliminar un nodo que contiene sub-nodos. Elimina primero a los hijos o muévelos.');
            return;
        }

        if (selectedNodeId === targetId) {
            setSelectedNodeId(null);
        }

        await load();
    };

    const handleAddChild = async (parentId: string, name: string, type: NodeType) => {
        await hierarchyStorage.createNode(name, type, parentId);
        await load();
    };

    const handleMoveNode = async (id: string, newParentId: string | null) => {
        const success = await hierarchyStorage.updateNodeParent(id, newParentId);
        if (!success) {
            setDialogMessage('No se puede mover el nodo allí. Operación inválida o ciclo infinito (un nodo padre no puede ser movido dentro de su propio descendiente).');
        } else {
            await load();
        }
    };

    const handleRailAddChild = () => {
        if (!selectedNode) return;
        handleOpenAddChildModal();
    };

    const handleRailRename = () => {
        if (!selectedNode) return;
        setRenameValue(selectedNode.name);
        setShowRenameDialog(true);
    };

    const handleConfirmRenameNode = async () => {
        if (!selectedNode) return;
        const nextName = renameValue.trim();
        if (!nextName || nextName === selectedNode.name) {
            setShowRenameDialog(false);
            return;
        }

        await handleUpdateNode(selectedNode.id, { name: nextName });
        setShowRenameDialog(false);
    };

    const handleRailMove = () => {
        if (!selectedNode) return;
        handleOpenMoveModal();
    };

    const handleCreateDashboard = async (nodeId: string) => {
        const node = allNodes.find(n => n.id === nodeId);
        if (!node) return;
        const newDashboard = await dashboardStorage.createEmptyDashboard(node.name);
        await handleDashboardLinkChange(nodeId, newDashboard.id);
        navigate(`/admin/builder/${newDashboard.id}`);
    };

    const handleRailDelete = () => {
        if (!selectedNode) return;
        handleDeleteNode(selectedNode.id);
    };

    const handleOpenAddChildModal = () => {
        if (!selectedNode) return;
        setNewChildName('');
        setNewChildType('equipment');
        setShowAddChildModal(true);
    };

    const handleCloseAddChildModal = () => {
        setShowAddChildModal(false);
        setNewChildName('');
        setNewChildType('equipment');
    };

    const handleOpenMoveModal = () => {
        if (!selectedNode) return;
        setMoveTargetId(selectedNode.parentId ?? '');
        setShowMoveModal(true);
    };

    const handleSaveNodeTypes = async (types: NodeTypeDefinition[]) => {
        await nodeTypeStorage.save(types);
        setNodeTypes(types);
        applyNodeTypeLabels(types);
        if (!types.some((type) => type.key === newChildType)) {
            setNewChildType(types[0]?.key ?? 'equipment');
        }
        setShowNodeTypeConfigDialog(false);
    };

    const handleConfirmAddChild = async () => {
        if (!selectedNode || !newChildName.trim()) return;
        await handleAddChild(selectedNode.id, newChildName.trim(), newChildType);
        setShowAddChildModal(false);
        setNewChildName('');
    };

    const handleConfirmMoveNode = async () => {
        if (!selectedNode) return;
        await handleMoveNode(selectedNode.id, moveTargetId || null);
        setShowMoveModal(false);
    };

    return (
        <AdminWorkspaceLayout
            contextBarPanel={
                <div className="flex h-full w-full items-center px-4">
                    <label className="relative w-full">
                        <Search
                            size={14}
                            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-industrial-muted"
                        />
                        <input
                            type="search"
                            value={searchTerm}
                            onChange={(event) => setSearchTerm(event.target.value)}
                            placeholder="Buscar área, box o equipo"
                            className={`${ADMIN_SIDEBAR_INPUT_CLS} h-9 pl-9 pr-3`}
                            aria-label="Buscar nodos de jerarquía por nombre"
                        />
                    </label>
                </div>
            }
            contextBar={
                selectedNode ? (
                    <div className="flex h-full w-full items-center justify-between gap-4 px-4">
                        <nav className="flex min-w-0 items-center gap-1 overflow-hidden uppercase text-industrial-muted">
                            {selectedNodeBreadcrumbs.map((ancestor, idx) => (
                                <span key={ancestor.id} className="flex min-w-0 items-center gap-1">
                                    {idx > 0 && <ChevronRight size={10} className="shrink-0 opacity-40" />}
                                    <span className={`truncate ${idx === selectedNodeBreadcrumbs.length - 1 ? 'text-white/80' : ''}`}>
                                        {ancestor.name}
                                    </span>
                                </span>
                            ))}
                        </nav>

                        <div className="flex shrink-0 items-center gap-2">
                            <AdminActionButton
                                onClick={handleOpenAddChildModal}
                                variant="primary"
                            >
                                <Plus size={14} /> Hijo
                            </AdminActionButton>
                            <AdminActionButton
                                onClick={handleOpenMoveModal}
                                variant="secondary"
                            >
                                <FolderSymlink size={14} /> Mover
                            </AdminActionButton>
                            <AdminActionButton
                                onClick={() => void handleDeleteNode(selectedNode.id)}
                                disabled={selectedNode.children.length > 0}
                                title={selectedNode.children.length > 0 ? 'No se puede eliminar un nodo con hijos' : 'Eliminar nodo'}
                                variant="secondary"
                            >
                                <Trash2 size={14} /> Eliminar
                            </AdminActionButton>
                        </div>
                    </div>
                ) : (
                    <div className="flex h-full w-full items-center px-4 uppercase text-industrial-muted">
                        Seleccioná un nodo para ver acciones contextualizadas
                    </div>
                )
            }
            rail={
                <HierarchyActionsRail
                    selectedNodeId={selectedNode?.id ?? null}
                    onAddRoot={handleAddRoot}
                    onAddChild={handleRailAddChild}
                    onRename={handleRailRename}
                    onMove={handleRailMove}
                    onDelete={handleRailDelete}
                    onConfigureTypes={() => setShowNodeTypeConfigDialog(true)}
                />
            }
            sidePanel={
                <div className="h-full min-h-0 overflow-y-auto py-2 hmi-scrollbar">
                    {isLoading ? (
                        <div className="flex h-full min-h-0 justify-center items-center">
                            <Loader2 className="animate-spin text-admin-accent" size={24} />
                        </div>
                    ) : searchTerm.trim() && filteredTree.length === 0 ? (
                        <div className="h-full min-h-0 px-4 py-4">
                            <AdminEmptyState
                                icon={SearchX}
                                message={`No encontramos nodos que coincidan con “${searchTerm.trim()}”.`}
                            />
                        </div>
                    ) : (
                        <HierarchyTree
                            nodes={filteredTree}
                            nodeTypes={nodeTypes}
                            selectedNodeId={selectedNodeId || undefined}
                            expandedNodeIds={expandedNodeIds}
                            onToggleExpand={handleToggleExpand}
                            onSelect={(n) => setSelectedNodeId(n.id)}
                        />
                    )}
                </div>
            }
        >
            <>
                <NodeDetailPanel
                    key={selectedNode?.id ?? 'empty-node'}
                    node={selectedNode}
                    dashboards={dashboards}
                    allNodes={allNodes}
                    nodeTypeLabels={nodeTypeLabels}
                    onUpdate={handleUpdateNode}
                    onDashboardLinkChange={handleDashboardLinkChange}
                    onCreateDashboard={handleCreateDashboard}
                />

                <AdminDialog
                    open={showAddChildModal && Boolean(selectedNode)}
                    title="NUEVO NODO HIJO"
                    onClose={handleCloseAddChildModal}
                    actions={(
                        <>
                            <AdminActionButton variant="secondary" onClick={handleCloseAddChildModal}>Cancelar</AdminActionButton>
                            <AdminActionButton
                                onClick={() => void handleConfirmAddChild()}
                                disabled={!newChildName.trim()}
                                variant="primary"
                            >Crear</AdminActionButton>
                        </>
                    )}
                >
                    <div>
                        <label className={`mb-1.5 block ${ADMIN_SIDEBAR_LABEL_CLS} w-auto`}>Nombre</label>
                        <input
                            autoFocus
                            type="text"
                            value={newChildName}
                            onChange={(e) => setNewChildName(e.target.value)}
                            className={`${ADMIN_SIDEBAR_INPUT_CLS} px-3 py-2`}
                        />
                    </div>

                    <div>
                        <label className={`mb-1.5 block ${ADMIN_SIDEBAR_LABEL_CLS} w-auto`}>Tipo</label>
                        <AdminSelect
                            value={newChildType}
                            onChange={(value) => setNewChildType(value as NodeType)}
                            options={nodeTypeOptions}
                        />
                    </div>
                </AdminDialog>

                <NodeTypeConfigDialog
                    key={`${showNodeTypeConfigDialog ? 'open' : 'closed'}-${nodeTypes.map((type) => `${type.key}:${type.label}:${type.icon}:${type.color}`).join('|')}`}
                    open={showNodeTypeConfigDialog}
                    onClose={() => setShowNodeTypeConfigDialog(false)}
                    nodeTypes={nodeTypes}
                    onSave={(types) => void handleSaveNodeTypes(types)}
                    nodeCountByType={nodeCountByType}
                />

                {showMoveModal && selectedNode && (
                    <AdminDialog
                        open={showMoveModal}
                        title="Reubicar Nodo"
                        onClose={() => setShowMoveModal(false)}
                        actions={(
                            <>
                                <AdminActionButton variant="secondary" onClick={() => setShowMoveModal(false)}>Cancelar</AdminActionButton>
                                <AdminActionButton
                                    onClick={() => void handleConfirmMoveNode()}
                                    variant="primary"
                                >Confirmar Mover</AdminActionButton>
                            </>
                        )}
                    >
                        <p className="text-industrial-muted">
                            ¿Bajo qué nodo padre querés mover "{selectedNode.name}"?
                        </p>

                        <select
                            value={moveTargetId}
                            onChange={(e) => setMoveTargetId(e.target.value)}
                            className={`${ADMIN_SIDEBAR_INPUT_CLS} px-3 py-2`}
                        >
                            <option value="">-- Mover a la Raíz (Sin padre) --</option>
                            {allNodes
                                .filter((n) => n.id !== selectedNode.id)
                                .map((n) => (
                                    <option key={n.id} value={n.id}>
                                        {getAncestors(n.id, allNodes).map((a) => a.name).join(' > ')}
                                    </option>
                                ))}
                        </select>
                    </AdminDialog>
                )}

                <AdminDialog
                    open={showAddRootDialog}
                    title="Nueva Locación / Planta Raíz"
                    onClose={() => setShowAddRootDialog(false)}
                    actions={(
                        <>
                            <AdminActionButton variant="secondary" onClick={() => setShowAddRootDialog(false)}>Cancelar</AdminActionButton>
                            <AdminActionButton
                                onClick={() => void handleConfirmAddRoot()}
                                disabled={!addRootName.trim()}
                                variant="primary"
                            >Crear</AdminActionButton>
                        </>
                    )}
                >
                    <div>
                        <label className={`${ADMIN_SIDEBAR_LABEL_CLS} mb-1.5 block w-auto`}>Nombre</label>
                        <input
                            autoFocus
                            type="text"
                            value={addRootName}
                            onChange={(e) => setAddRootName(e.target.value)}
                            className={`${ADMIN_SIDEBAR_INPUT_CLS} px-3 py-2`}
                        />
                    </div>
                </AdminDialog>

                <AdminDialog
                    open={showRenameDialog && Boolean(selectedNode)}
                    title="Renombrar Nodo"
                    onClose={() => setShowRenameDialog(false)}
                    actions={(
                        <>
                            <AdminActionButton variant="secondary" onClick={() => setShowRenameDialog(false)}>Cancelar</AdminActionButton>
                            <AdminActionButton
                                onClick={() => void handleConfirmRenameNode()}
                                disabled={!renameValue.trim() || renameValue.trim() === selectedNode?.name}
                                variant="primary"
                            >Guardar</AdminActionButton>
                        </>
                    )}
                >
                    <div>
                        <label className={`${ADMIN_SIDEBAR_LABEL_CLS} mb-1.5 block w-auto`}>Nombre</label>
                        <input
                            autoFocus
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            className={`${ADMIN_SIDEBAR_INPUT_CLS} px-3 py-2`}
                        />
                    </div>
                </AdminDialog>

                <AdminDialog
                    open={Boolean(deleteTargetNodeId)}
                    title="Confirmar Eliminación"
                    onClose={() => setDeleteTargetNodeId(null)}
                    actions={(
                        <>
                            <AdminActionButton variant="secondary" onClick={() => setDeleteTargetNodeId(null)}>Cancelar</AdminActionButton>
                            <AdminActionButton
                                onClick={() => void handleConfirmDeleteNode()}
                                variant="secondary"
                            >Eliminar</AdminActionButton>
                        </>
                    )}
                >
                    <p className="text-industrial-muted">¿Seguro que deseás eliminar el nodo seleccionado?</p>
                </AdminDialog>

                <AdminDialog
                    open={Boolean(dialogMessage)}
                    title="Operación no permitida"
                    onClose={() => setDialogMessage(null)}
                    actions={(
                        <AdminActionButton variant="primary" onClick={() => setDialogMessage(null)}>Entendido</AdminActionButton>
                    )}
                >
                    <p className="text-industrial-muted">{dialogMessage}</p>
                </AdminDialog>
            </>
        </AdminWorkspaceLayout>
    );
}
