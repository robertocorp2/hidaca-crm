"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type SearchItem = {
  entityType: string;
  entityId: string;
  title: string;
  subtitle: string;
  href: string;
};

type SearchGroup = {
  entityType: string;
  label: string;
  items: SearchItem[];
};

export function GlobalSearch({
  onNavigate,
}: {
  onNavigate(item: SearchItem): void;
}) {
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [state, setState] = useState<
    "idle" | "loading" | "ready" | "empty" | "error"
  >("idle");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const items = useMemo(() => groups.flatMap((group) => group.items), [groups]);

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
        inputRef.current?.focus();
      }
      if (event.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    }
    function outside(event: PointerEvent) {
      if (
        rootRef.current &&
        event.target instanceof Node &&
        !rootRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", keydown);
    window.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("pointerdown", outside);
    };
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setState("loading");
      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal },
        );
        const result = (await response.json()) as {
          groups?: SearchGroup[];
          error?: string;
        };
        if (!response.ok || !result.groups) throw new Error(result.error);
        setGroups(result.groups);
        setState(result.groups.length ? "ready" : "empty");
        setActiveIndex(result.groups.length ? 0 : -1);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setGroups([]);
        setState("error");
        setActiveIndex(-1);
      }
    }, 260);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  function choose(item: SearchItem) {
    onNavigate(item);
    setOpen(false);
    setQuery("");
    setGroups([]);
    setState("idle");
  }

  return (
    <div className="global-search" ref={rootRef}>
      <div className="global-search-input">
        <span aria-hidden="true">⌕</span>
        <input
          aria-activedescendant={
            activeIndex >= 0 ? `global-search-${activeIndex}` : undefined
          }
          aria-autocomplete="list"
          aria-controls="global-search-results"
          aria-expanded={open}
          aria-label="Buscar en toda la aplicación"
          autoComplete="off"
          name="globalSearch"
          onChange={(event) => {
            const nextQuery = event.target.value;
            setQuery(nextQuery);
            setOpen(true);
            if (nextQuery.trim().length < 2) {
              setGroups([]);
              setState("idle");
              setActiveIndex(-1);
            }
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (!open) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((value) =>
                Math.min(value + 1, Math.max(items.length - 1, 0)),
              );
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((value) => Math.max(value - 1, 0));
            } else if (event.key === "Enter" && items[activeIndex]) {
              event.preventDefault();
              choose(items[activeIndex]);
            }
          }}
          placeholder="Buscar registros…"
          ref={inputRef}
          role="combobox"
          value={query}
        />
        <kbd>⌘/Ctrl K</kbd>
      </div>
      {open && (query.length > 0 || state !== "idle") && (
        <div
          aria-label="Resultados de búsqueda"
          className="global-search-results"
          id="global-search-results"
          role="listbox"
        >
          {query.trim().length < 2 && (
            <p>Escribe al menos dos caracteres.</p>
          )}
          {state === "loading" && <p aria-live="polite">Buscando…</p>}
          {state === "empty" && <p>No se encontraron resultados.</p>}
          {state === "error" && (
            <p role="alert">
              No se pudo completar la búsqueda. Revisa tu conexión e inténtalo
              de nuevo.
            </p>
          )}
          {state === "ready" &&
            groups.map((group) => (
              <section className="search-group" key={group.entityType}>
                <h2>{group.label}</h2>
                {group.items.map((item) => {
                  const index = items.findIndex(
                    (candidate) =>
                      candidate.entityType === item.entityType &&
                      candidate.entityId === item.entityId,
                  );
                  return (
                    <a
                      aria-selected={index === activeIndex}
                      className={index === activeIndex ? "active" : ""}
                      href={item.href}
                      id={`global-search-${index}`}
                      key={`${item.entityType}:${item.entityId}`}
                      onClick={(event) => {
                        event.preventDefault();
                        choose(item);
                      }}
                      onMouseEnter={() => setActiveIndex(index)}
                      role="option"
                    >
                      <span aria-hidden="true" className="search-result-icon">
                        {group.label.slice(0, 2).toUpperCase()}
                      </span>
                      <span>
                        <strong>{item.title}</strong>
                        <small>{item.subtitle || group.label}</small>
                      </span>
                    </a>
                  );
                })}
              </section>
            ))}
        </div>
      )}
    </div>
  );
}
