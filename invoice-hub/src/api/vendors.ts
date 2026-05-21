import client from './client'

export const vendorsApi = {
  list: (q?: string) => client.get('/invoice-mgmt/vendors', { params: q ? { q } : {} }),
  get: (id: number) => client.get(`/invoice-mgmt/vendors/${id}`),
  create: (data: Record<string, unknown>) => client.post('/invoice-mgmt/vendors', data),
  update: (id: number, data: Record<string, unknown>) => client.patch(`/invoice-mgmt/vendors/${id}`, data),
  destroy: (id: number) => client.delete(`/invoice-mgmt/vendors/${id}`),
}
