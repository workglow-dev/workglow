import React from "react";
import { createPortal } from "react-dom";
import { JsonTree } from "./JsonTree";

function DialogPortal({ children }: { children: React.ReactNode }) {
  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        pointerEvents: "auto",
      }}
    >
      {children}
    </div>,
    document.body
  );
}
interface DataDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  data: Record<string, unknown> | null;
}

export const DataDialog: React.FC<DataDialogProps> = ({ isOpen, onClose, title, data }) => {
  if (!isOpen) return null;

  const handleDialogClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <DialogPortal>
      <div
        className="fixed inset-0 flex items-center justify-center z-[2000] bg-black/50 pointer-events-auto"
        onClick={onClose}
      >
        <div
          className="bg-gray-900 rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] flex flex-col"
          onClick={handleDialogClick}
        >
          <div className="flex justify-between items-center p-4 border-b border-gray-700">
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
              ✕
            </button>
          </div>
          <div className="p-4 overflow-auto flex-1">
            {data && Object.keys(data).length > 0 ? (
              <JsonTree data={data} expandLevel={2} />
            ) : (
              <div className="text-gray-400">No data available</div>
            )}
          </div>
        </div>
      </div>
    </DialogPortal>
  );
};
