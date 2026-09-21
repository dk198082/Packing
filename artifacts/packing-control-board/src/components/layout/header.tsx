import { Box } from 'lucide-react';
import type { Team } from '@/lib/types';
import type { ViewMode } from '@/lib/types';
import { FilterBar } from '@/components/board/filter-bar';
import { useAuth } from '@/hooks/use-auth';

interface HeaderProps {
  activeTeam: Team;
  setActiveTeam: (t: Team) => void;
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
}
const isEmbedded =
  typeof window !== "undefined" &&
  window.self !== window.top;

export function Header({
  activeTeam,
  setActiveTeam,
  searchTerm,
  setSearchTerm,
  viewMode,
  setViewMode,
}: HeaderProps) {
  const { user, logout } = useAuth();

  return (
    <div className="flex min-h-10 flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 border border-primary text-primary flex items-center justify-center rounded-sm">
          <Box className="w-5 h-5" />
        </div>
        {!isEmbedded && (
        <div>
          <h1 className="text-xl font-bold text-foreground font-sans tracking-wide leading-tight">PACKING CONTROL BOARD</h1>
        </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-3">
        <FilterBar
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          viewMode={viewMode}
          setViewMode={setViewMode}
        />
        <div className="flex items-center bg-card border-2 border-primary/70 rounded-md p-1 shadow-[0_0_14px_hsl(var(--primary)/0.12)]">
          <button
            onClick={() => setActiveTeam("PARTS")}
            title="Pools included: Parts, SRV - Part, Repair*, RMA, Used Eqt"
            aria-label="Parts tab. Pools included: Parts, SRV - Part, Repair*, RMA, Used Eqt"
            className={`px-9 py-2 rounded-sm text-sm font-bold uppercase transition-colors ${
              activeTeam === "PARTS" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
            aria-pressed={activeTeam === "PARTS"}
          >
            PARTS
          </button>
          <button
            onClick={() => setActiveTeam("SYSTEM")}
            title="Pools included: System, Exhib"
            aria-label="System tab. Pools included: System, Exhib"
            className={`px-9 py-2 rounded-sm text-sm font-bold uppercase transition-colors flex items-center gap-2 ${
              activeTeam === "SYSTEM" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
            aria-pressed={activeTeam === "SYSTEM"}
          >
            SYSTEM
          </button>
        </div>
        {!isEmbedded && (
        <div className="flex items-center gap-2 border-l border-border pl-3">
          <div className="max-w-40 text-right leading-tight">
            <div className="truncate text-[11px] font-semibold text-foreground" title={user.email}>
              {user.displayName}
            </div>
            <div className="text-[9px] font-bold uppercase tracking-wider text-primary">
              {user.role}
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            className="rounded-sm border border-border px-2 py-1 text-[10px] font-bold uppercase text-muted-foreground hover:border-primary hover:text-primary"
          >
            Sign out
          </button>
        </div>
        )}
      </div>
    </div>
  );
}
