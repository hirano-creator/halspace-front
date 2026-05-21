import client from './client'

export const purchaseRequestsApi = {
  list: (params?: Record<string, string>) =>
    client.get('/invoice-mgmt/purchase-requests', { params }),

  get: (id: number) =>
    client.get(`/invoice-mgmt/purchase-requests/${id}`),

  create: (data: Record<string, unknown>) =>
    client.post('/invoice-mgmt/purchase-requests', data),

  update: (id: number, data: Record<string, unknown>) =>
    client.patch(`/invoice-mgmt/purchase-requests/${id}`, data),

  approve: (id: number, action: 'approve' | 'reject') =>
    client.post(`/invoice-mgmt/purchase-requests/${id}/approve`, { action }),

  destroy: (id: number) =>
    client.delete(`/invoice-mgmt/purchase-requests/${id}`),
}
