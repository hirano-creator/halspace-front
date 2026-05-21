import client from './client'

export const invoicesApi = {
  list: (params?: Record<string, string>) =>
    client.get('/invoice-mgmt/invoices', { params }),

  get: (id: number) =>
    client.get(`/invoice-mgmt/invoices/${id}`),

  upload: (formData: FormData) =>
    client.post('/invoice-mgmt/invoices', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),

  update: (id: number, data: Record<string, unknown>) =>
    client.patch(`/invoice-mgmt/invoices/${id}`, data),

  updateStatus: (id: number, status: string) =>
    client.patch(`/invoice-mgmt/invoices/${id}/status`, { status }),

  approve: (id: number, action: 'approve' | 'reject' | 'comment', comment?: string) =>
    client.post(`/invoice-mgmt/invoices/${id}/approve`, { action, comment }),

  link: (id: number, purchaseRequestId: number) =>
    client.post(`/invoice-mgmt/invoices/${id}/link`, { purchase_request_id: purchaseRequestId }),

  destroy: (id: number) =>
    client.delete(`/invoice-mgmt/invoices/${id}`),
}
