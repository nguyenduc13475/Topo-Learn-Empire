import {
  addEdge,
  Background,
  Connection,
  Controls,
  Edge,
  Handle,
  MiniMap,
  Node,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import { useCallback, useEffect, useState } from "react";

// --- 1. Custom Concept Node ---
const ConceptNode = ({ data }: { data: any }) => {
  const isDue = data.next_review_date && data.next_review_date <= Math.floor(Date.now() / 1000);
  const isLearned = data.repetitions > 2; // Arbitrary threshold for "learned"

  let borderClass = "border-blue-600";
  let bgClass = "bg-white";

  if (isDue) {
    borderClass = "border-orange-500";
    bgClass = "bg-orange-50";
  } else if (isLearned) {
    borderClass = "border-green-500";
    bgClass = "bg-green-50";
  }

  return (
    <div
      className={`px-3 py-2 shadow-lg rounded-lg ${bgClass} border-l-4 ${borderClass} min-w-50 max-w-64`}
    >
      <Handle type="target" position={Position.Top} className="w-2 h-2 bg-gray-400" />
      <div className="font-bold text-sm text-gray-800 border-b border-gray-200 pb-1 mb-1 leading-tight flex justify-between items-center">
        <span>{data.label}</span>
        {isDue && (
          <span className="text-[10px] bg-orange-200 text-orange-800 px-1 rounded ml-2 font-normal">
            Due
          </span>
        )}
        {isLearned && !isDue && (
          <span className="text-[10px] bg-green-200 text-green-800 px-1 rounded ml-2 font-normal">
            Learned
          </span>
        )}
      </div>
      {data.definition && (
        <div
          className="text-[10px] text-gray-600 line-clamp-3 leading-snug"
          title={data.definition}
        >
          {data.definition}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="w-2 h-2 bg-gray-400" />
    </div>
  );
};

const nodeTypes = { concept: ConceptNode };

// --- 2. Dagre Layout Engine ---
const getLayoutedElements = (nodes: Node[], edges: Edge[], direction = "TB") => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: direction, nodesep: 50, ranksep: 80 });

  nodes.forEach((node) => {
    // Approximate node dimensions for Dagre calculations
    dagreGraph.setNode(node.id, { width: 220, height: 80 });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);

    // Fallback if Gemini hallucinates edges to non-existent nodes
    if (!nodeWithPosition) return node;

    return {
      ...node,
      targetPosition: Position.Top,
      sourcePosition: Position.Bottom,
      position: {
        x: nodeWithPosition.x - 220 / 2,
        y: nodeWithPosition.y - 80 / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
};

// --- 3. React Flow Implementation ---
const initialNodes: Node[] = [
  {
    id: "welcome-node",
    position: { x: 250, y: 150 },
    data: { label: "Welcome to Topo-Learn\nPaste Gemini JSON to begin" },
    type: "default",
  },
];
const initialEdges: Edge[] = [];

interface KnowledgeGraphProps {
  graphData: { nodes: Node[]; edges: Edge[] } | null;
}

export default function KnowledgeGraph({ graphData }: KnowledgeGraphProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  useEffect(() => {
    if (graphData && graphData.nodes && graphData.edges) {
      // Run the layout algorithm before setting the nodes
      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
        graphData.nodes,
        graphData.edges,
      );
      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
    }
  }, [graphData, setNodes, setEdges]);

  const onConnect = useCallback(
    (params: Connection | Edge) => setEdges((eds) => addEdge({ ...params, animated: true }, eds)),
    [setEdges],
  );

  return (
    <div className="w-full h-full relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_, node) => setSelectedNode(node)}
        fitView
        attributionPosition="bottom-left"
        defaultEdgeOptions={{ type: "smoothstep", animated: true }}
      >
        <Controls />
        <MiniMap zoomable pannable nodeClassName={() => "bg-blue-500"} />
        <Background variant={"dots" as any} gap={16} size={1} color="#cbd5e1" />
      </ReactFlow>

      {/* Node Detail Side Panel */}
      {selectedNode && selectedNode.id !== "welcome-node" && (
        <div className="absolute top-4 right-4 w-75 bg-white shadow-xl rounded-lg border border-gray-200 z-10 flex flex-col animate-in fade-in slide-in-from-right-8">
          <div className="p-3 border-b border-gray-100 flex justify-between items-center bg-gray-50 rounded-t-lg">
            <h3 className="font-bold text-gray-800 truncate pr-2">Concept Details</h3>
            <button
              onClick={() => setSelectedNode(null)}
              className="text-gray-500 hover:text-gray-800 cursor-pointer px-2"
            >
              ✕
            </button>
          </div>
          <div className="p-4 overflow-y-auto max-h-100 flex flex-col gap-3">
            <div>
              <h4 className="text-lg font-bold text-blue-700 mb-1">
                {selectedNode.data.label as string}
              </h4>
              <div className="flex gap-2 text-xs font-medium">
                <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded border border-gray-200">
                  Repetitions: {(selectedNode.data.repetitions as number) || 0}
                </span>
                <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded border border-gray-200">
                  Ease: {Number(selectedNode.data.ease_factor || 2.5).toFixed(2)}
                </span>
              </div>
            </div>

            <div className="bg-gray-50 p-3 rounded-md border border-gray-100">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 block">
                Definition
              </span>
              <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                {(selectedNode.data.definition as string) || "No definition provided."}
              </p>
            </div>

            {typeof selectedNode.data.context === "string" &&
              selectedNode.data.context.trim() !== "" && (
                <div className="bg-yellow-50 p-3 rounded-md border border-yellow-100">
                  <span className="text-xs font-bold text-yellow-700 uppercase tracking-wider mb-1 block">
                    Source Context
                  </span>
                  <p
                    className="text-xs text-yellow-900 whitespace-pre-wrap leading-relaxed italic line-clamp-4 hover:line-clamp-none transition-all cursor-pointer"
                    title="Click to view full context"
                  >
                    "{selectedNode.data.context}"
                  </p>
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  );
}
