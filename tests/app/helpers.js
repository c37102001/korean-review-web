import { expect } from '@playwright/test';

const projectId = 'demo-korean-review-web';
const authAdminUrl = `http://127.0.0.1:9099/emulator/v1/projects/${projectId}/accounts`;
const firestoreAdminUrl = `http://127.0.0.1:8080/emulator/v1/projects/${projectId}/databases/(default)/documents`;

export async function resetTestData(request) {
  for (const url of [authAdminUrl, firestoreAdminUrl]) {
    const response = await request.delete(url);
    expect(response.ok(), `Failed to reset test emulator: ${url}`).toBeTruthy();
  }
}

export async function prepareAppPage(page) {
  await page.clock.setFixedTime(new Date('2026-09-21T09:00:00+08:00'));
  const productionRequests = [];
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (/^(?:identitytoolkit|securetoken|firestore)\.googleapis\.com$/.test(url.hostname)
      || url.hostname.endsWith('.firebaseio.com')
      || url.hostname.endsWith('.firebaseapp.com')) {
      productionRequests.push(url.href);
      return route.abort();
    }
    return route.continue();
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: '登入後開始測驗' })).toBeVisible();
  return () => expect(productionRequests, 'The App must not call production Firebase').toEqual([]);
}

export async function submitCredentials(page, email, password = 'test-pass-123') {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('密碼').fill(password);
  await page.getByRole('button', { name: '登入', exact: true }).click();
}

export async function register(page, email, password = 'test-pass-123') {
  await page.getByRole('button', { name: '還沒有帳號？建立新帳號' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('密碼').fill(password);
  await page.getByRole('button', { name: '建立帳號', exact: true }).click();
  await expect(page.getByRole('button', { name: '登出' })).toBeVisible();
}

export async function signOut(page) {
  await page.getByRole('button', { name: '登出' }).click();
  await expect(page.getByRole('heading', { name: '登入後開始測驗' })).toBeVisible();
}

export async function seedFolder(page, request, name) {
  const uid = await page.evaluate(async () => {
    const { auth } = await import('/korean-review-web/src/firebase.js');
    return auth.currentUser?.uid;
  });
  expect(uid, 'The App must be signed in before seeding a folder').toBeTruthy();
  const url = `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents/users/${uid}/folders/seed-folder`;
  const response = await request.patch(url, { headers: { Authorization: 'Bearer owner' }, data: { fields: {
    id: { stringValue: 'seed-folder' },
    name: { stringValue: name },
    tag: { stringValue: '' },
    wordIds: { arrayValue: { values: [] } },
    createdAt: { stringValue: '2026-09-20T00:00:00.000Z' },
    updatedAt: { timestampValue: '2026-09-20T00:00:00.000Z' },
  } } });
  expect(response.ok(), await response.text()).toBeTruthy();
}

export async function setNetworkOffline(context, offline = true) {
  await context.setOffline(offline);
}

export async function failFirestoreWrites(page) {
  await page.route('http://127.0.0.1:8080/**', (route) => {
    if (route.request().url().includes('/Write/')) return route.abort('failed');
    return route.continue();
  });
}
