interface GraphFiltersProps {
  nodeTypes: Array<{ node_type: string; count: number }>;
  selectedType: string | null;
  onTypeChange: (type: string | null) => void;
}

export function GraphFilters({ nodeTypes, selectedType, onTypeChange }: GraphFiltersProps) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      <button
        type="button"
        onClick={() => onTypeChange(null)}
        className={`px-3 py-2 rounded-full text-xs font-medium transition-colors min-h-[2.75rem] ${
          !selectedType ? "bg-brand text-on-brand" : "bg-surface-alt text-skin-muted hover:bg-surface"
        }`}
      >
        All
      </button>
      {nodeTypes.map(({ node_type, count }) => (
        <button
          type="button"
          key={node_type}
          onClick={() => onTypeChange(selectedType === node_type ? null : node_type)}
          className={`px-3 py-2 rounded-full text-xs font-medium transition-colors min-h-[2.75rem] ${
            selectedType === node_type ? "bg-brand text-on-brand" : "bg-surface-alt text-skin-muted hover:bg-surface"
          }`}
        >
          {node_type} ({count})
        </button>
      ))}
    </div>
  );
}
