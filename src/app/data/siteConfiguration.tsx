import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiJson } from './apiClient';

type SiteConfiguration = { businessName: string; supportEmail: string; aiEnabled: boolean };
const fallback: SiteConfiguration = { businessName: 'Own Masters', supportEmail: '', aiEnabled: false };
const Context = createContext(fallback);
export function SiteConfigurationProvider({ children }: { children: ReactNode }) {
  const [configuration, setConfiguration] = useState(fallback);
  useEffect(() => {
    let active = true;
    void apiJson<SiteConfiguration>('/api/site').then(value => {
      if (active && typeof value.businessName === 'string' && typeof value.supportEmail === 'string')
        setConfiguration({ ...value, aiEnabled: value.aiEnabled === true });
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  return <Context.Provider value={configuration}>{children}</Context.Provider>;
}
export const useSiteConfiguration = () => useContext(Context);
