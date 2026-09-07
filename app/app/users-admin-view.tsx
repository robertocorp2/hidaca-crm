"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  permissionModules,
  resolveEffectivePermissions,
  type EffectivePermissions,
  type PermissionAction,
  type PermissionEffect,
  type PermissionModuleKey,
  type StaffRole,
} from "../lib/modules";
import type { StaffUser } from "./types";
import {
  ActiveFilterChip,
  AutocompleteInput,
  Breadcrumbs,
  FilterableStatus,
  Modal,
  PageHeader,
  PageSizeControl,
  Pagination,
  dateTime,
  usePagination,
  useUrlState,
} from "./ui";

type Override = { module: PermissionModuleKey; action: PermissionAction; effect: PermissionEffect };
type PermissionPayload = { overrides: Override[]; permissions: EffectivePermissions };
type Editor = { user: StaffUser | null; name: string; email: string; role: StaffRole; active: boolean; overrides: Override[]; permissions: EffectivePermissions };

function effectivePreview(role: StaffRole, overrides: Override[]): EffectivePermissions {
  return resolveEffectivePermissions(role, [], overrides);
}

function roleLabel(role: StaffRole) {
  return role === "admin" ? "Administrador" : role === "operator" ? "Operador" : "Solo lectura";
}

export function UsersAdminView({
  access, currentUserEmail, users, setUsers, setMessage, confirm,
}: {
  access: Record<PermissionAction, boolean>;
  currentUserEmail: string;
  users: StaffUser[];
  setUsers(value: StaffUser[] | ((current: StaffUser[]) => StaffUser[])): void;
  setMessage(value: string): void;
  confirm(message: string, confirmLabel: string, action: () => Promise<void>): void;
}) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [tab, setTab] = useState<"general" | "permissions">("general");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<PermissionModuleKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [listQuery, setListQuery] = useUrlState("q");
  const [statusFilter, setStatusFilter] = useUrlState("status");
  const [roleFilter, setRoleFilter] = useUrlState("role");
  const [pageSizeValue, setPageSizeValue] = useUrlState("pageSize", "10");

  async function openUser(user: StaffUser) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/users/${user.id}/permissions`);
      const result = (await response.json()) as PermissionPayload & { error?: string };
      if (!response.ok) throw new Error(result.error);
      setEditor({ user, name: user.name, email: user.email, role: user.role, active: user.active, ...result });
      setTab("general");
    } catch (error) {
      setMessage(error instanceof Error && error.message ? error.message : "No se pudieron cargar los permisos.");
    } finally { setBusy(false); }
  }

  function openNew() {
    const role: StaffRole = "operator";
    setEditor({ user: null, name: "", email: "", role, active: true, overrides: [], permissions: effectivePreview(role, []) });
    setTab("general");
  }

  function setOverride(moduleKey: PermissionModuleKey, action: PermissionAction, effect: "inherit" | PermissionEffect) {
    if (!editor) return;
    const next = editor.overrides.filter((item) => item.module !== moduleKey || item.action !== action);
    if (effect !== "inherit") next.push({ module: moduleKey, action, effect });
    setEditor({ ...editor, overrides: next, permissions: effectivePreview(editor.role, next) });
  }

  function applyPreset(kind: "reset" | "all" | "readonly" | "none") {
    if (!editor) return;
    const action = async () => {
      let next: Override[] = [];
      if (kind === "all") next = permissionModules.flatMap((permissionModule) =>
        permissionModule.actions.filter(() => permissionModule.key !== "usuarios" || editor.role === "admin")
          .map((action) => ({ module: permissionModule.key, action, effect: "allow" as const })));
      if (kind === "readonly") next = permissionModules.flatMap((permissionModule) =>
        permissionModule.actions.map((action) => ({ module: permissionModule.key, action, effect: action === "view" ? "allow" as const : "deny" as const })));
      if (kind === "none") next = permissionModules.flatMap((permissionModule) =>
        permissionModule.actions.map((action) => ({ module: permissionModule.key, action, effect: "deny" as const })));
      setEditor({ ...editor, overrides: next, permissions: effectivePreview(editor.role, next) });
    };
    confirm("Este preset reemplazará la personalización actual. Podrás revisar el resultado antes de guardar.", "Aplicar preset", action);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editor) return;
    setBusy(true);
    setMessage("");
    try {
      if (!editor.user) {
        const response = await fetch("/api/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
          name: editor.name, email: editor.email, role: editor.role, active: editor.active, overrides: editor.overrides,
        }) });
        const result = (await response.json()) as { user?: StaffUser; error?: string };
        if (!response.ok || !result.user) throw new Error(result.error);
        setUsers((current) => [result.user!, ...current]);
        setMessage("Usuario autorizado con sus permisos iniciales.");
      } else {
        const generalPayload = self ? { name: editor.name } : {
          name: editor.name, email: editor.email, role: editor.role, active: editor.active,
        };
        let savedUser = editor.user;
        if (access.edit) {
          const general = await fetch(`/api/users/${editor.user.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({
            ...generalPayload,
            ...(!self && access.administer ? { overrides: editor.overrides } : {}),
          }) });
          const generalResult = (await general.json()) as { user?: StaffUser; error?: string };
          if (!general.ok || !generalResult.user) throw new Error(generalResult.error);
          savedUser = generalResult.user;
        } else if (!self && access.administer) {
          const permissions = await fetch(`/api/users/${editor.user.id}/permissions`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ overrides: editor.overrides }) });
          const permissionResult = (await permissions.json()) as PermissionPayload & { error?: string };
          if (!permissions.ok) throw new Error(permissionResult.error);
        }
        setUsers((current) => current.map((item) => item.id === savedUser.id ? savedUser : item));
        setMessage("Usuario y permisos actualizados.");
      }
      setEditor(null);
    } catch (error) {
      setMessage(error instanceof Error && error.message ? error.message : "No se pudieron guardar los cambios.");
    } finally { setBusy(false); }
  }

  function remove(user: StaffUser) {
    confirm(`¿Eliminar permanentemente el acceso de “${user.name}”? Perderá acceso de inmediato y sus permisos personalizados se eliminarán.`, "Eliminar usuario", async () => {
      const response = await fetch(`/api/users/${user.id}`, { method: "DELETE" });
      if (!response.ok) {
        const result = (await response.json()) as { error?: string };
        setMessage(result.error ?? "No se pudo eliminar el usuario.");
        return;
      }
      setUsers((current) => current.filter((item) => item.id !== user.id));
      setEditor(null);
      setMessage("Usuario eliminado.");
    });
  }

  const filteredModules = useMemo(() => permissionModules.filter((permissionModule) =>
    `${permissionModule.label} ${permissionModule.group}`.toLowerCase().includes(query.toLowerCase().trim())), [query]);
  const self = editor?.user?.email.toLowerCase() === currentUserEmail.toLowerCase();
  const filteredUsers = useMemo(() => users.filter((user) => {
    const matchesQuery = `${user.name} ${user.email} ${roleLabel(user.role)}`.toLowerCase().includes(listQuery.trim().toLowerCase());
    const matchesStatus = !statusFilter || statusFilter === (user.active ? "active" : "inactive");
    return matchesQuery && matchesStatus && (!roleFilter || user.role === roleFilter);
  }).toSorted((left, right) => left.name.localeCompare(right.name, "es")), [listQuery, roleFilter, statusFilter, users]);
  const pageSize = pageSizeValue === "all" ? Math.max(filteredUsers.length, 1) : Number(pageSizeValue) || 10;
  const { page, pageItems, setPage, totalPages } = usePagination(filteredUsers, pageSize);

  return <>
    <Breadcrumbs items={[{ label: "Inicio" }, { label: "Usuarios" }]} />
    <PageHeader action={<div className="page-heading-actions">{access.administer && <>
        {/* The export endpoint returns a downloadable JSON backup rather than an application page. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className="secondary-button" href="/api/users/export">Exportar seguridad</a>
      </>}{access.create && <button className="primary-button" onClick={openNew} type="button">+ Autorizar usuario</button>}</div>} description="Administra el acceso y los permisos efectivos por módulo." eyebrow="Seguridad" title="Usuarios autorizados" />
    <div className="toolbar toolbar-filters">
      <AutocompleteInput ariaLabel="Buscar usuarios" onChange={(value) => { setListQuery(value); setPage(1); }} onSelect={(option) => { setListQuery(option.label); setPage(1); }} options={filteredUsers.slice(0, 8).map((user) => ({ id: String(user.id), label: user.name, secondary: user.email }))} placeholder="Escribe un nombre o correo…" value={listQuery} />
      <select aria-label="Filtrar usuarios por rol" onChange={(event) => { setRoleFilter(event.target.value); setPage(1); }} value={roleFilter}><option value="">Todos los roles</option><option value="admin">Administrador</option><option value="operator">Operador</option><option value="viewer">Solo lectura</option></select>
      <select aria-label="Filtrar usuarios por estado" onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }} value={statusFilter}><option value="">Todos los estados</option><option value="active">Activos</option><option value="inactive">Inactivos</option></select>
      <PageSizeControl label="Usuarios por página" onChange={(value) => { setPageSizeValue(value); setPage(1); }} value={pageSizeValue} />
      <span className="record-count"><strong>{filteredUsers.length}</strong> usuarios</span>
    </div>
    {(statusFilter || roleFilter) && <div className="active-filter-row">{statusFilter && <ActiveFilterChip label={`Estado: ${statusFilter === "active" ? "Activo" : "Inactivo"}`} onClear={() => { setStatusFilter(""); setPage(1); }} />}{roleFilter && <ActiveFilterChip label={`Rol: ${roleLabel(roleFilter as StaffRole)}`} onClear={() => { setRoleFilter(""); setPage(1); }} />}</div>}
    <section className="panel"><div className="user-list compact-user-list">
      {pageItems.map((user) => <div className="user-list-row collection-user-row" key={user.id}>
        <button className="user-row-main" disabled={busy} onClick={() => openUser(user)} type="button"><span><strong title={user.name}>{user.name}</strong><small title={user.email}>{user.email}</small></span><span>{roleLabel(user.role)}</span></button>
        <FilterableStatus label={user.active ? "Activo" : "Inactivo"} onFilter={() => { setStatusFilter(user.active ? "active" : "inactive"); setPage(1); }} />
        <button aria-label={`Abrir ${user.name}`} className="user-row-open" disabled={busy} onClick={() => openUser(user)} type="button">›</button>
      </div>)}
    </div><Pagination onPageChange={setPage} page={page} totalPages={totalPages} /></section>
    {editor && <Modal eyebrow={editor.user ? "Seguridad" : "Nueva autorización"} onClose={() => setEditor(null)} title={editor.user ? editor.user.name : "Autorizar usuario"} wide>
      <form className="user-editor" onSubmit={save}>
        <div className="user-tabs" role="tablist"><button aria-selected={tab === "general"} onClick={() => setTab("general")} role="tab" type="button">General</button>{access.administer && <button aria-selected={tab === "permissions"} onClick={() => setTab("permissions")} role="tab" type="button">Permisos</button>}</div>
        {tab === "general" ? <div className="user-general-grid">
          <label htmlFor="user-editor-name">Nombre<input autoComplete="name" id="user-editor-name" name="name" required value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} /></label>
          <label htmlFor="user-editor-email">Correo de ChatGPT<input autoComplete="email" disabled={self} id="user-editor-email" name="email" required type="email" value={editor.email} onChange={(event) => setEditor({ ...editor, email: event.target.value })} /></label>
          <label htmlFor="user-editor-role">Rol<select autoComplete="off" disabled={self} id="user-editor-role" name="role" value={editor.role} onChange={(event) => { const role = event.target.value as StaffRole; setEditor({ ...editor, role, permissions: effectivePreview(role, editor.overrides) }); }}><option value="admin">Administrador</option><option value="operator">Operador</option><option value="viewer">Solo lectura</option></select></label>
          <label htmlFor="user-editor-status">Estado<select autoComplete="off" disabled={self} id="user-editor-status" name="status" value={editor.active ? "active" : "inactive"} onChange={(event) => {
            const active = event.target.value === "active";
            if (!active && editor.active) {
              confirm("Al desactivar este usuario perderá acceso a HIDACA de inmediato al guardar los cambios.", "Desactivar", async () => setEditor((current) => current ? { ...current, active: false } : current));
            } else setEditor({ ...editor, active });
          }}><option value="active">Activo</option><option value="inactive">Inactivo</option></select></label>
          {editor.user && <div className="user-dates"><span>Creado: {dateTime(editor.user.createdAt)}</span><span>Última actualización: {dateTime(editor.user.updatedAt)}</span></div>}
          {self && <p className="inline-warning">Tu propia seguridad está protegida: no puedes cambiar correo, rol, estado, permisos ni eliminar tu acceso.</p>}
        </div> : <div className="permission-editor">
          <div className="permission-tools"><input aria-label="Buscar módulos" autoComplete="off" name="permissionSearch" onChange={(event) => setQuery(event.target.value)} placeholder="Buscar módulos…" value={query} /><div><button onClick={() => applyPreset("reset")} type="button">Restablecer rol</button><button onClick={() => applyPreset("all")} type="button">Permitir todos</button><button onClick={() => applyPreset("readonly")} type="button">Solo lectura</button><button onClick={() => applyPreset("none")} type="button">Quitar todos</button></div></div>
          <div className="permission-groups">{filteredModules.map((module) => {
            const requiredBy = permissionModules.filter((item) => item.dependencies.includes(module.key as never) && editor.permissions[item.key].view).map((item) => item.label);
            const locked = requiredBy.length > 0;
            const viewOverride = editor.overrides.find((item) => item.module === module.key && item.action === "view")?.effect ?? "inherit";
            return <article key={module.key}><div className="permission-row"><span><small>{module.group}</small><strong>{module.label}</strong>{locked && <em>Requerido por {requiredBy.join(", ")}</em>}</span><label className="permission-toggle"><input checked={editor.permissions[module.key].view} disabled={self || locked || module.key === "usuarios" && editor.role !== "admin"} name={`permission-${module.key}-view`} onChange={(event) => setOverride(module.key, "view", event.target.checked ? "allow" : "deny")} type="checkbox" /> Acceso</label><button aria-expanded={expanded === module.key} onClick={() => setExpanded(expanded === module.key ? null : module.key)} type="button">CRUD</button></div>
              {expanded === module.key && <div className="permission-actions">{module.actions.map((action) => <label key={action}><span>{action === "view" ? "Ver" : action === "create" ? "Crear" : action === "edit" ? "Editar" : action === "approve" ? "Aprobar" : action === "delete" ? "Eliminar" : "Administrar"}<small>{editor.permissions[module.key][action] ? "Efectivo: permitido" : "Efectivo: denegado"}</small></span><select disabled={self || locked || module.key === "usuarios" && editor.role !== "admin"} name={`permission-${module.key}-${action}`} onChange={(event) => setOverride(module.key, action, event.target.value as "inherit" | PermissionEffect)} value={action === "view" ? viewOverride : editor.overrides.find((item) => item.module === module.key && item.action === action)?.effect ?? "inherit"}><option value="inherit">Heredar</option><option value="allow">Permitir</option><option value="deny">Denegar</option></select></label>)}</div>}</article>;
          })}</div>
        </div>}
        <div className="modal-actions"><button className="secondary-button" onClick={() => setEditor(null)} type="button">Cancelar</button>{editor.user && !self && access.delete && <button className="danger-link" onClick={() => remove(editor.user!)} type="button">Eliminar usuario</button>}{(!editor.user && access.create || editor.user && (access.edit || access.administer)) && <button className="primary-button" disabled={busy || self && tab === "permissions"}>{busy ? "Guardando…" : "Guardar cambios"}</button>}</div>
      </form>
    </Modal>}
  </>;
}
