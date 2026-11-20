export interface NfProjectView {
  id: string;
  name: string;
  description: string | null;
}

export interface NfServiceView {
  id: string;
  name: string;
  /** combined | build | deployment */
  type: string;
  buildStatus: string | null;
  deploymentStatus: string | null;
  lastChange: string | null;
}

export interface NfBuildView {
  id: string;
  branch: string | null;
  sha: string | null;
  status: string | null;
  concluded: boolean;
  success: boolean | null;
  message: string | null;
  createdAt: string | null;
}

export interface NfServiceDetailView extends NfServiceView {
  branch: string | null;
  repoUrl: string | null;
  canBuild: boolean;
  builds: NfBuildView[];
}

export interface NfSelfPort {
  name: string;
  internalPort: number;
  public: boolean;
  /** code.run URL from NF_HOSTS (null until the service restarted with this port). */
  url: string | null;
}

/** StackDock's own Northflank service (for per-project URLs). */
export interface NfSelfView {
  onNorthflank: boolean;
  projectId: string | null;
  serviceId: string | null;
  serviceType: string | null;
  routingMode: 'northflank-ports' | 'path' | 'host';
  ports: NfSelfPort[];
  /** Why ports can't be managed right now, if so. */
  problem: string | null;
}

export interface ExposeResult {
  /** Northflank redeploys StackDock to apply port changes. */
  restarting: boolean;
  portName: string;
}

export const NF_BUILD_ACTIVE = [
  'QUEUED',
  'PENDING',
  'STARTING',
  'CLONING',
  'BUILDING',
  'UPLOADING',
  'IN_PROGRESS',
];
