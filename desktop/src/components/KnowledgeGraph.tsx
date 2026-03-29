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
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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

  const dimClass = data.isDimmed
    ? "opacity-30 grayscale transition-all duration-300"
    : "opacity-100 transition-all duration-300";
  const highlightClass = data.isTarget ? "ring-4 ring-blue-400 scale-105" : "";

  return (
    <div
      className={`px-3 py-2 shadow-lg rounded-lg ${bgClass} border-l-4 ${borderClass} min-w-50 max-w-64 ${dimClass} ${highlightClass}`}
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

  const layoutedNodes = nodes.map((node, index) => {
    const nodeWithPosition = dagreGraph.node(node.id);

    // Fallback if Dagre fails to map a sub-graph
    if (!nodeWithPosition) {
      return {
        ...node,
        targetPosition: Position.Top,
        sourcePosition: Position.Bottom,
        position: { x: (index % 5) * 250, y: Math.floor(index / 5) * 150 },
      };
    }

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
  documents?: { id: string; title: string }[];
}

export default function KnowledgeGraph({ graphData, documents = [] }: KnowledgeGraphProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [filterDocId, setFilterDocId] = useState<string>("");
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);

  // Function to find ancestors and descendants for visual isolation
  const getRelatedNodes = useCallback((nodeId: string, allEdges: Edge[]) => {
    const related = new Set<string>();
    related.add(nodeId);

    // Find ancestors (prerequisites)
    let queue = [nodeId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      allEdges
        .filter((e) => e.target === current)
        .forEach((e) => {
          if (!related.has(e.source)) {
            related.add(e.source);
            queue.push(e.source);
          }
        });
    }

    // Find descendants (dependent concepts)
    queue = [nodeId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      allEdges
        .filter((e) => e.source === current)
        .forEach((e) => {
          if (!related.has(e.target)) {
            related.add(e.target);
            queue.push(e.target);
          }
        });
    }
    return related;
  }, []);

  useEffect(() => {
    if (!graphData || !graphData.nodes || !graphData.edges) return;

    if (filterDocId && focusedNodeId) {
      setFocusedNodeId(null); // Clear focus if switching document filter
    }

    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      graphData.nodes,
      graphData.edges,
    );

    let activeSet: Set<string> | null = null;
    if (focusedNodeId) {
      activeSet = getRelatedNodes(focusedNodeId, layoutedEdges);
    } else if (filterDocId) {
      activeSet = new Set(
        layoutedNodes.filter((n) => n.data.document_id === filterDocId).map((n) => n.id),
      );
    } else if (searchQuery.trim() !== "") {
      activeSet = new Set(
        layoutedNodes
          .filter((n) => (n.data.label as string).toLowerCase().includes(searchQuery.toLowerCase()))
          .map((n) => n.id),
      );
    }

    const processedNodes = layoutedNodes.map((n) => ({
      ...n,
      data: {
        ...n.data,
        isDimmed: activeSet ? !activeSet.has(n.id) : false,
        isTarget: n.id === focusedNodeId,
      },
    }));

    const processedEdges = layoutedEdges.map((e) => {
      const isActiveEdge = activeSet ? activeSet.has(e.source) && activeSet.has(e.target) : false;
      const sourceNode = layoutedNodes.find((n) => n.id === e.source);
      const isSourceLearned = sourceNode && (sourceNode.data.repetitions as number) > 0;

      return {
        ...e,
        style: {
          opacity: activeSet ? (isActiveEdge ? 1 : 0.1) : 1,
          stroke: isActiveEdge ? "#3b82f6" : isSourceLearned ? "#22c55e" : "#cbd5e1",
          strokeWidth: isActiveEdge ? 2 : isSourceLearned ? 1.5 : 1,
        },
        animated: activeSet ? isActiveEdge : !isSourceLearned,
      };
    });

    setNodes(processedNodes);
    setEdges(processedEdges);
  }, [graphData, focusedNodeId, searchQuery, setNodes, setEdges, getRelatedNodes]);

  const onConnect = useCallback(
    (params: Connection | Edge) => setEdges((eds) => addEdge({ ...params, animated: true }, eds)),
    [setEdges],
  );

  return (
    <div className="w-full h-full relative">
      {/* Top Controls Container */}
      <div className="absolute top-4 left-4 z-10 flex flex-col gap-2 w-72">
        {/* Search Bar */}
        <div className="bg-white/90 backdrop-blur rounded-lg shadow-md border border-gray-200 p-2 flex items-center gap-2">
          <span className="text-gray-500 pl-2">🔍</span>
          <input
            type="text"
            placeholder="Search concepts..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (e.target.value) {
                if (focusedNodeId) setFocusedNodeId(null);
                if (filterDocId) setFilterDocId("");
              }
            }}
            className="w-full bg-transparent outline-none text-sm text-gray-700 placeholder-gray-400 py-1"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="text-gray-400 hover:text-gray-600 px-2 cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>

        {/* Document Filter */}
        {documents && documents.length > 0 && (
          <div className="bg-white/90 backdrop-blur rounded-lg shadow-md border border-gray-200 p-2 flex items-center">
            <select
              value={filterDocId}
              onChange={(e) => {
                setFilterDocId(e.target.value);
                setSearchQuery("");
                if (focusedNodeId) setFocusedNodeId(null);
              }}
              className="w-full bg-transparent outline-none text-sm text-gray-700 py-1 cursor-pointer"
            >
              <option value="">All Documents</option>
              {documents.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.title}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

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
              <div className="text-sm text-gray-800 leading-relaxed [&>p]:mb-2 last:[&>p]:mb-0 [&>ul]:list-disc [&>ul]:ml-4 [&>ol]:list-decimal [&>ol]:ml-4 [&>strong]:text-blue-800 [&>code]:bg-gray-200 [&>code]:px-1 [&>code]:rounded [&>pre]:bg-gray-800 [&>pre]:text-gray-100 [&>pre]:p-2 [&>pre]:rounded overflow-x-auto">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {(selectedNode.data.definition as string) || "No definition provided."}
                </ReactMarkdown>
              </div>
            </div>

            {typeof selectedNode.data.context === "string" &&
              selectedNode.data.context.trim() !== "" && (
                <div className="bg-yellow-50 p-3 rounded-md border border-yellow-100">
                  <span className="text-xs font-bold text-yellow-700 uppercase tracking-wider mb-1 block">
                    Source Context
                  </span>
                  <div
                    className="text-xs text-yellow-900 leading-relaxed italic line-clamp-4 hover:line-clamp-none transition-all cursor-pointer [&>p]:mb-2 last:[&>p]:mb-0"
                    title="Click to view full context"
                  >
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {selectedNode.data.context as string}
                    </ReactMarkdown>
                  </div>
                </div>
              )}

            <div className="mt-4 border-t border-gray-200 pt-4 flex flex-col gap-2">
              <button
                onClick={() => {
                  setFocusedNodeId(focusedNodeId === selectedNode.id ? null : selectedNode.id);
                  setSearchQuery("");
                }}
                className={`w-full py-2 px-4 rounded text-sm font-bold shadow-sm transition-colors cursor-pointer ${focusedNodeId === selectedNode.id ? "bg-gray-200 text-gray-800 hover:bg-gray-300" : "bg-blue-600 text-white hover:bg-blue-700"}`}
              >
                {focusedNodeId === selectedNode.id ? "🌌 Unfocus Path" : "🎯 Focus Learning Path"}
              </button>
              {focusedNodeId === selectedNode.id && (
                <p className="text-[10px] text-gray-500 text-center">
                  Showing prerequisites and dependent concepts.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
