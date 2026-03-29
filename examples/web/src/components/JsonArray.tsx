/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from "react";
import { JsonTree } from "./JsonTree";

type JsonArrayProps = {
  data: unknown[];
  expandLevel?: number;
};

/**
 * Component for displaying JSON arrays with collapsible sections
 */
export const JsonArray: React.FC<JsonArrayProps> = ({ data, expandLevel = 1 }) => {
  const [isExpanded, setIsExpanded] = useState(expandLevel > 0);

  useEffect(() => {
    setIsExpanded(expandLevel > 0);
  }, [expandLevel]);

  const toggleExpand = () => {
    setIsExpanded(!isExpanded);
  };

  if (!Array.isArray(data)) {
    return null;
  }

  const arrayLength = data.length;

  return (
    <div className="json-array">
      <div className="json-toggle" onClick={toggleExpand}>
        <span className={`json-toggle-icon ${isExpanded ? "expanded" : "collapsed"}`}>▼</span>
        <span className="json-preview">
          {"["}
          {!isExpanded &&
            arrayLength > 0 &&
            ` ${arrayLength} ${arrayLength === 1 ? "item" : "items"} `}
          {"]"}
        </span>
      </div>

      {isExpanded && (
        <div className="json-array-content">
          {arrayLength === 0 ? (
            <div className="json-empty">{"[ ]"}</div>
          ) : (
            data.map((item, index) => (
              <div key={index} className="json-array-item">
                <JsonTree
                  data={item}
                  label={`${index}`}
                  expandLevel={expandLevel - 1}
                  isRoot={false}
                />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
