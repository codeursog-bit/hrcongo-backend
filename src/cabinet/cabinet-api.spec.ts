import { api } from '../../../frontend/services/api';

describe('Cabinet file exports', () => {
  afterEach(() => jest.restoreAllMocks());
  it('downloads a POST response as binary rather than parsing PDF as JSON', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('%PDF-QA', { status: 201, headers: { 'Content-Type': 'application/pdf' } }));
    const body = { payrollIds: ['qa-payroll'] };
    expect(await (await api.postBlob('/payrolls/export/batch-pdf', body)).text()).toBe('%PDF-QA');
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/payrolls/export/batch-pdf'), expect.objectContaining({ method: 'POST', credentials: 'include', body: JSON.stringify(body) }));
  });
  it('replays the same POST body after refreshing an expired access cookie', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('SAGE-QA', { status: 201 }));
    const body = { payrollIds: ['qa-payroll'], companyId: 'qa-company' };
    expect(await (await api.postBlob('/payrolls/export/sage', body)).text()).toBe('SAGE-QA');
    expect(fetchMock.mock.calls[0][1]).toEqual(fetchMock.mock.calls[2][1]);
    expect(fetchMock.mock.calls[1][0]).toEqual(expect.stringContaining('/auth/refresh'));
  });
  it('does not turn a refused export into a downloadable file', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 403 }));
    await expect(api.postBlob('/payrolls/export/sage', {})).rejects.toThrow();
  });
});
