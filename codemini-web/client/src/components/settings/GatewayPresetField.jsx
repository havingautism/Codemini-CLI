import { useRef, useState } from "react";
import { Command } from "cmdk";
import { CaretDown, Check, MagnifyingGlass, SlidersHorizontal, X } from "@/lib/icons";
import gatewayLogoSheet from "@/assets/gateway-provider-logos.png";
import GlideMenu from "@/components/beautiful-ui/GlideMenu.jsx";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { t } from "../../../i18n/index.js";
import catalog from "../../../../shared/gateway-provider-catalog.json";

const LOGO_COLS = 20;
const LOGO_ROWS = 17;

export function findGatewayPreset(id, protocol, baseUrl) {
  if (id === "custom") return undefined;
  const normalizedUrl = String(baseUrl || "").trim().replace(/\/+$/, "");
  const matches = (entry) => entry.protocol === protocol && entry.baseUrl === normalizedUrl;
  return catalog.providers.find((entry) => entry.id === id && matches(entry))
    || catalog.providers.find(matches);
}

const fieldShellClass = "flex min-h-9 w-full min-w-0 items-center rounded-lg border border-(--border-strong) bg-(--bg-input) text-[13px] font-normal text-(--text-primary) transition-[border-color,background-color] outline-none hover:border-(--control-border-hover) hover:bg-(--bg-primary)";

const menuItemClass = "relative z-1 flex min-h-8 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] text-(--text-primary) outline-none transition-colors data-[selected=true]:bg-(--bg-hover) data-[disabled=true]:cursor-default data-[disabled=true]:text-(--text-muted) data-[disabled=true]:opacity-60";

const popoverSearchInputClass = "min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] text-(--text-primary) outline-none placeholder:text-(--text-muted)";

function PopoverSearchBar({ value, onValueChange, label, placeholder }) {
  return (
    <div className="mb-1.5 flex h-8 items-center gap-2 rounded-lg bg-(--bg-hover) px-2.5 text-(--text-muted)">
      <MagnifyingGlass size={14} aria-hidden="true" className="shrink-0" />
      <Command.Input
        value={value}
        onValueChange={onValueChange}
        aria-label={label}
        placeholder={placeholder}
        className={popoverSearchInputClass}
      />
      {value && (
        <button
          type="button"
          aria-label={t("projectClearSearch")}
          onClick={() => onValueChange("")}
          className="inline-flex size-5 min-h-0! min-w-0! shrink-0 items-center justify-center rounded-sm text-(--text-muted) transition-colors hover:text-(--text-primary)"
        >
          <X size={12} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export function GatewayPresetField({ id, value, disabled, onSelect }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const search = query.trim().toLowerCase();
  const results = catalog.providers.filter((entry) =>
    `${entry.name} ${entry.id}`.toLowerCase().includes(search));
  const select = (entry) => {
    onSelect(entry);
    setQuery("");
    setOpen(false);
  };
  const isCustom = !value;
  return (
    <Popover open={open} onOpenChange={(next) => {
      setOpen(next);
      if (!next) setQuery("");
    }}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            fieldShellClass,
            "gap-2.5 px-3 py-1 focus-visible:border-(--control-border-hover) focus-visible:bg-(--bg-primary)",
            "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
            open && "border-(--control-border-hover) bg-(--bg-primary)",
          )}
        >
          <GatewayLogo index={value?.logoIndex} custom={isCustom} fallbackLabel={value?.name} />
          <span className="min-w-0 truncate leading-5">{value?.name || t("gatewayPresetCustom")}</span>
          <CaretDown
            size={14}
            aria-hidden="true"
            className={cn("ml-auto shrink-0 text-(--text-muted) transition-transform duration-150", open && "rotate-180")}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-(--radix-popover-trigger-width) max-w-[calc(100vw-2rem)] p-1.5">
        <Command label={t("gatewayPreset")} shouldFilter={false}>
          <PopoverSearchBar
            value={query}
            onValueChange={setQuery}
            label={t("gatewayPresetSearch")}
            placeholder={t("gatewayPresetSearch")}
          />
          <Command.List className="max-h-64 scroll-py-1 overflow-y-auto overscroll-contain">
            <GlideMenu className="flex flex-col gap-0.5">
              {!search && (
                <Command.Item
                  value="custom"
                  data-menu-row
                  aria-current={isCustom ? "true" : undefined}
                  onSelect={() => select(null)}
                  className={cn(menuItemClass, isCustom && "bg-(--selected-bg) font-medium")}
                >
                  <GatewayLogo custom />
                  <span className="min-w-0 flex-1 truncate leading-5">{t("gatewayPresetCustom")}</span>
                  {isCustom && <Check size={14} aria-hidden="true" className="ml-auto shrink-0 text-(--text-primary)" />}
                </Command.Item>
              )}
              {!results.length && <p className="px-2.5 py-3 text-center text-xs text-(--text-muted)">{t("gatewayPresetEmpty")}</p>}
              {results.map((entry) => {
                const selected = value?.id === entry.id;
                return (
                  <Command.Item
                    key={entry.id}
                    value={entry.id}
                    disabled={!entry.baseUrl}
                    data-menu-row={entry.baseUrl ? "" : undefined}
                    aria-current={selected ? "true" : undefined}
                    onSelect={() => select(entry)}
                    className={cn(menuItemClass, selected && "bg-(--selected-bg) font-medium")}
                  >
                    <GatewayLogo index={entry.logoIndex} fallbackLabel={entry.name} />
                    <span className="min-w-0 flex-1 break-words leading-5">{entry.name}</span>
                    {!entry.baseUrl ? (
                      <span className="ml-auto shrink-0 text-[11px] text-(--text-muted)">{t("gatewayPresetUnsupported")}</span>
                    ) : selected ? (
                      <Check size={14} aria-hidden="true" className="ml-auto shrink-0 text-(--text-primary)" />
                    ) : null}
                  </Command.Item>
                );
              })}
            </GlideMenu>
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function GatewayModelField({ id, value, models = [], placeholder, disabled, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);
  const search = query.trim().toLowerCase();
  const filtered = search
    ? models.filter((modelId) => modelId.toLowerCase().includes(search))
    : models;
  const showSearch = models.length > 6;

  const choose = (modelId) => {
    onChange(modelId);
    setQuery("");
    setOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <Popover open={open} onOpenChange={(next) => {
      setOpen(next);
      if (!next) setQuery("");
    }}>
      <PopoverAnchor asChild>
        <div
          className={cn(
            fieldShellClass,
            "focus-within:border-(--control-border-hover) focus-within:bg-(--bg-primary)",
            open && "border-(--control-border-hover) bg-(--bg-primary)",
            disabled && "pointer-events-none opacity-50",
          )}
        >
          <input
            ref={inputRef}
            id={id}
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
            value={value}
            disabled={disabled}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && !open) {
                e.preventDefault();
                setOpen(true);
              } else if (e.key === "Escape" && open) {
                e.preventDefault();
                setOpen(false);
              }
            }}
            className="min-w-0 flex-1 border-0 bg-transparent py-1.5 pl-3 pr-1 text-[13px] leading-5 text-(--text-primary) outline-none placeholder:text-(--text-muted) disabled:cursor-not-allowed"
          />
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={t("gatewayChooseModel")}
              aria-expanded={open}
              disabled={disabled}
              className={cn(
                "relative inline-flex w-[38px] min-h-0! min-w-0! shrink-0 self-stretch items-center justify-center rounded-r-[7px] text-(--text-muted) transition-colors outline-none",
                "before:pointer-events-none before:absolute before:top-2 before:bottom-2 before:left-0 before:w-px before:bg-(--border-default)/70",
                "hover:bg-(--bg-hover)/55 hover:text-(--text-primary) focus-visible:bg-(--bg-hover)/55 focus-visible:text-(--text-primary)",
                "disabled:pointer-events-none disabled:opacity-50",
                open && "bg-(--bg-hover)/55 text-(--text-primary)",
              )}
            >
              <CaretDown
                size={14}
                aria-hidden="true"
                className={cn("transition-transform duration-150", open && "rotate-180")}
              />
            </button>
          </PopoverTrigger>
        </div>
      </PopoverAnchor>
      <PopoverContent align="start" sideOffset={6} className="w-(--radix-popover-trigger-width) max-w-[calc(100vw-2rem)] p-1.5">
        <Command label={t("gatewayChooseModel")} shouldFilter={false}>
          {showSearch && (
            <PopoverSearchBar
              value={query}
              onValueChange={setQuery}
              label={t("gatewayModelSearch")}
              placeholder={t("gatewayModelSearch")}
            />
          )}
          <Command.List className="max-h-64 scroll-py-1 overflow-y-auto overscroll-contain">
            <GlideMenu className="flex flex-col gap-0.5">
              {!filtered.length && (
                <p className="px-2.5 py-3 text-center text-xs text-(--text-muted)">{t("gatewayModelEmpty")}</p>
              )}
              {filtered.map((modelId) => {
                const selected = value === modelId;
                return (
                  <Command.Item
                    key={modelId}
                    value={modelId}
                    data-menu-row
                    aria-current={selected ? "true" : undefined}
                    onSelect={() => choose(modelId)}
                    className={cn(menuItemClass, selected && "bg-(--selected-bg) font-medium")}
                  >
                    <span className="min-w-0 flex-1 break-all font-mono text-[12.5px] leading-5">{modelId}</span>
                    {selected && <Check size={14} aria-hidden="true" className="ml-auto shrink-0 text-(--text-primary)" />}
                  </Command.Item>
                );
              })}
            </GlideMenu>
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function GatewayLogo({ index, custom = false, fallbackLabel = "" }) {
  if (custom) {
    return (
      <span
        aria-hidden="true"
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-(--bg-hover) text-(--text-muted)"
      >
        <SlidersHorizontal size={12} />
      </span>
    );
  }
  if (!Number.isInteger(index)) {
    const initial = String(fallbackLabel || "?").trim().slice(0, 1).toUpperCase() || "?";
    return (
      <span
        aria-hidden="true"
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-(--bg-hover) text-[10px] font-semibold text-(--text-muted)"
      >
        {initial}
      </span>
    );
  }
  const col = index % LOGO_COLS;
  const row = Math.floor(index / LOGO_COLS);
  const posX = (col / (LOGO_COLS - 1)) * 100;
  const posY = (row / (LOGO_ROWS - 1)) * 100;
  return (
    <span
      aria-hidden="true"
      className="inline-block size-5 shrink-0 rounded-[5px] bg-white bg-no-repeat shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]"
      style={{
        backgroundImage: `url("${gatewayLogoSheet}")`,
        backgroundPosition: `${posX}% ${posY}%`,
        backgroundSize: `${LOGO_COLS * 100}% ${LOGO_ROWS * 100}%`,
      }}
    />
  );
}
