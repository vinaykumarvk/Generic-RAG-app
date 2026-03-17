interface GraphFiltersProps {
  nodeTypes: Array<{ node_type: string; count: number }>;
  selectedType: string | null;
  onTypeChange: (type: string | null) => void;
}

export function GraphFilters({ nodeTypes, selectedType, onTypeChange }: GraphFiltersProps) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      <button
        onClick={() => onTypeChange(null)}
        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
          !selectedType ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
        }`}
      >
        All
      </button>
      {nodeTypes.map(({ node_type, count }) => (
        <button
          key={node_type}
          onClick={() => onTypeChange(selectedType === node_type ? null : node_type)}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
            selectedType === node_type ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          {node_type} ({count})
        </button>
      ))}
    </div>
  );
}
