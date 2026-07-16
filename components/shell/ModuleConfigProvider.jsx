"use client";

import { createContext, useContext } from "react";

const ModuleConfigContext = createContext(null);

export function ModuleConfigProvider({ value, children }) {
  return (
    <ModuleConfigContext.Provider value={value}>
      {children}
    </ModuleConfigContext.Provider>
  );
}

export function useModuleConfig() {
  return useContext(ModuleConfigContext);
}
