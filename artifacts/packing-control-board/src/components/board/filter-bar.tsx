import type { ViewMode } from '@/lib/types';
import { LayoutGrid, List, Search } from 'lucide-react';

interface FilterBarProps {
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
}

export function FilterBar({ searchTerm, setSearchTerm, viewMode, setViewMode }: FilterBarProps) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-3 text-xs font-mono">
      <div className="flex min-w-0 items-center gap-2">
        <label htmlFor="order-search" className="text-muted-foreground shrink-0">Search by:</label>
        <div className="relative w-[220px] max-w-[28vw] min-w-[150px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            id="order-search"
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Sales Order or Customer"
            aria-label="Search by Sales Order or Customer"
            className="w-full bg-card border border-border text-foreground placeholder:text-muted-foreground pl-7 pr-2.5 py-1 rounded-sm outline-none focus:border-primary"
          />
        </div>
      </div>

      <div className="flex shrink-0 items-center bg-card border border-border rounded-sm p-0.5">
        <button
          onClick={() => setViewMode('CARD')}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-sm transition-colors ${viewMode === 'CARD' ? 'bg-muted text-primary' : 'text-muted-foreground hover:text-foreground'}`}
        >
          <LayoutGrid className="w-3.5 h-3.5" /> Card View
        </button>
        <button
          onClick={() => setViewMode('TABLE')}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-sm transition-colors ${viewMode === 'TABLE' ? 'bg-muted text-primary' : 'text-muted-foreground hover:text-foreground'}`}
        >
          <List className="w-3.5 h-3.5" /> Table View
        </button>
      </div>
    </div>
  );
}
