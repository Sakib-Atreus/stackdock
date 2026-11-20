export interface ActivityItem {
  id: string;
  action: string;
  status: 'SUCCESS' | 'FAILURE';
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, string | number | boolean | null> | null;
  createdAt: string;
}

export interface ActivityPage {
  items: ActivityItem[];
  nextCursor: string | null;
}
