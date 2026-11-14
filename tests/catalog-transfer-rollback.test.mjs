import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

class ProductContentError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'ProductContentError';
    this.status = status;
  }
}

async function buildHarness() {
  const state = {
    products: [
      {
        id: 'prod_1',
        slug: 'existing-charger',
        deleted_at: null,
        price_paise: 199900,
        sale_price_paise: null,
        category_id: 'cat_power',
        product_type_id: 'pt_charger',
        is_active: true,
        inventory_mode: 'parent',
        stock_id: 'stk_1',
        on_hand: 10,
        reserved: 4,
        track_inventory: true,
        low_stock_threshold: 2,
      },
      {
        id: 'archived-cable',
        slug: 'archived-cable',
        deleted_at: '2026-10-01T00:00:00Z',
        price_paise: 99900,
        sale_price_paise: null,
        category_id: 'cat_power',
        product_type_id: null,
        is_active: false,
        inventory_mode: 'parent',
        stock_id: null,
        on_hand: 0,
        reserved: 0,
        track_inventory: false,
        low_stock_threshold: 0,
      },
    ],
    productTypes: [{ id: 'pt_charger', category_id: 'cat_power' }],
    transactions: [],
    importJobs: [],
    importErrors: [],
    hooks: {
      writeProductContent: null,
      saveProductMetadata: null,
      strictMetadataAudit: null,
      adjustVariantInventory: null,
      onInsertProducts: null,
      onUpdateProduct: null,
      onInsertPriceHistory: null,
    },
  };

  function sqlText(strings) {
    return strings.join(' ? ').replace(/\s+/g, ' ').trim();
  }

  function makeTag(txRecord) {
    function tag(first, ...values) {
      if (!Array.isArray(first) || !Object.hasOwn(first, 'raw')) {
        return { __frag: first, values };
      }
      const query = sqlText(first);
      if (txRecord) txRecord.queries.push(query);

      if (query.startsWith('select id, slug, name from categories')) {
        return Promise.resolve([{ id: 'cat_power', slug: 'power', name: 'Power' }]);
      }
      if (query.startsWith('select id, name, slug from brands')) {
        return Promise.resolve([{ id: 'brd_gadzio', name: 'Gadzio', slug: 'gadzio' }]);
      }
      if (query.startsWith('select id, label from conditions')) {
        return Promise.resolve([{ id: 'cond_new', label: 'New' }]);
      }
      if (query.startsWith('select id, slug, deleted_at from products')) {
        return Promise.resolve(
          state.products.map((p) => ({ id: p.id, slug: p.slug, deleted_at: p.deleted_at })),
        );
      }
      if (query.startsWith('select track_inventory from stock')) {
        const productId = values[0];
        const product = state.products.find((p) => p.id === productId);
        return Promise.resolve(product?.stock_id ? [{ track_inventory: product.track_inventory }] : []);
      }
      if (query.includes('from product_variants')) {
        return Promise.resolve([]);
      }
      if (query.startsWith('select id from products where id in')) {
        return Promise.resolve([]);
      }
      if (query.startsWith('select id from stock where product_id=')) {
        return Promise.resolve([]);
      }
      if (query.includes('from products p left join stock s')) {
        const idsFrag = values[0]?.__frag ?? [];
        return Promise.resolve(state.products.filter((p) => idsFrag.includes(p.id) && p.deleted_at == null));
      }
      if (query.startsWith('select id from product_types')) {
        const [typeId, categoryId] = values;
        return Promise.resolve(
          state.productTypes.filter((t) => t.id === typeId && t.category_id === categoryId),
        );
      }
      if (query.startsWith('insert into products')) {
        if (state.hooks.onInsertProducts) return state.hooks.onInsertProducts(values);
        return Promise.resolve([]);
      }
      if (query.startsWith('update products set name =')) {
        if (state.hooks.onUpdateProduct) return state.hooks.onUpdateProduct(values);
        return Promise.resolve([]);
      }
      if (query.startsWith('insert into price_history')) {
        if (state.hooks.onInsertPriceHistory) return state.hooks.onInsertPriceHistory(values);
        return Promise.resolve([]);
      }
      if (query.startsWith('insert into catalog_imports')) {
        const rows = values[0]?.__frag ?? [];
        state.importJobs.push(...rows.map((r) => ({ ...r })));
        return Promise.resolve([]);
      }
      if (query.startsWith('update catalog_imports set status =')) {
        if (query.includes("status = 'imported'")) {
          const [created, updated, importId] = values;
          const job = state.importJobs.find((j) => j.id === importId);
          if (job) Object.assign(job, { status: 'imported', rows_created: created, rows_updated: updated });
        } else {
          const [failed, importId] = values;
          const job = state.importJobs.find((j) => j.id === importId);
          if (job) Object.assign(job, { status: 'rejected', rows_created: 0, rows_updated: 0, rows_failed: failed });
        }
        return Promise.resolve([]);
      }
      if (query.startsWith('insert into catalog_import_errors')) {
        if (values[0]?.__frag) {
          state.importErrors.push(...values[0].__frag);
        } else {
          state.importErrors.push({
            import_id: values[0],
            row_number: values[1],
            column_name: values[2],
            message: values[3],
          });
        }
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    }

    tag.json = (value) => value;
    tag.begin = async (fn) => {
      const txRecord = { queries: [], committed: false, rolledBack: false };
      state.transactions.push(txRecord);
      const tx = makeTag(txRecord);
      try {
        const result = await fn(tx);
        txRecord.committed = true;
        return result;
      } catch (error) {
        txRecord.rolledBack = true;
        throw error;
      }
    };
    return tag;
  }

  const sql = makeTag(null);
  const rules = await createJiti(import.meta.url, {
    moduleCache: false,
    alias: { '@': path.join(root, 'src') },
  }).import(path.join(root, 'src/lib/catalog/product-metadata-rules.ts'));
  const jiti = createJiti(import.meta.url, {
    moduleCache: false,
    alias: { '@': path.join(root, 'src') },
    virtualModules: {
      '@/lib/platform/db': { getSql: () => sql },
      '@/lib/catalog/product-metadata-rules': rules,
      './product-metadata': {
        metadataGate: async () => {},
        saveProductMetadataUsing: async (...args) => {
          if (state.hooks.saveProductMetadata) return state.hooks.saveProductMetadata(...args);
        },
        strictMetadataAudit: async (...args) => {
          if (state.hooks.strictMetadataAudit) return state.hooks.strictMetadataAudit(...args);
        },
      },
      './product-content': {
        ProductContentError,
        writeProductContentUsing: async (...args) => {
          if (state.hooks.writeProductContent) return state.hooks.writeProductContent(...args);
        },
      },
      './variant-inventory': {
        adjustVariantInventoryUsing: async (...args) => {
          if (state.hooks.adjustVariantInventory) return state.hooks.adjustVariantInventory(...args);
        },
      },
    },
  });
  const transfer = await jiti.import(path.join(root, 'src/lib/store-admin/catalog-transfer.ts'));

  return {
    state,
    MetadataError: rules.MetadataError,
    runCatalogueImport: transfer.runCatalogueImport,
    postgresErrorToImportError: transfer.postgresErrorToImportError,
    postgresColumnHint: transfer.postgresColumnHint,
  };
}

function captureWarns(run) {
  const original = console.warn;
  const calls = [];
  console.warn = (...args) => calls.push(args);
  return Promise.resolve()
    .then(run)
    .then(
      (result) => {
        console.warn = original;
        return { result, warns: calls };
      },
      (error) => {
        console.warn = original;
        throw error;
      },
    );
}

test('loadContext surfaces both distinct-id slugs and soft-deleted products before dryRun or commit writes', async () => {
  const { state, runCatalogueImport } = await buildHarness();

  // Collides with live product `prod_1` whose slug is `existing-charger` (id !== slug).
  const liveCollision = await runCatalogueImport({
    filename: 'collide.csv',
    csv: 'name,slug,category,price\nCharger,existing-charger,Power,1999\n',
    dryRun: true,
    staffId: 'stf_1',
  });
  assert.equal(liveCollision.ok, true);
  assert.equal(liveCollision.data.status, 'rejected');
  assert.equal(liveCollision.data.errors[0].column, 'product_id');

  // Collides with soft-deleted product `archived-cable`.
  const deletedCollision = await runCatalogueImport({
    filename: 'deleted.csv',
    csv: 'name,slug,category,price\nCable,archived-cable,Power,999\n',
    dryRun: false,
    staffId: 'stf_1',
  });
  assert.equal(deletedCollision.ok, true);
  assert.equal(deletedCollision.data.status, 'rejected');
  assert.equal(deletedCollision.data.errors[0].column, 'slug');
  assert.match(deletedCollision.data.errors[0].message, /deleted product/);
  // Never reached product inserts.
  assert.equal(
    state.transactions.some((t) => t.queries.some((q) => q.startsWith('insert into products'))),
    false,
  );
});

test('dryRun verifies commit-time metadata and category/type rules inside a rolled-back transaction', async () => {
  const { state, MetadataError, runCatalogueImport } = await buildHarness();

  // 1. Valid dryRun must run writes and roll back cleanly.
  const validDry = await runCatalogueImport({
    filename: 'valid.csv',
    csv: 'product_id,name,slug,category,price\nprod_1,Charger,existing-charger,Power,1999\n',
    dryRun: true,
    staffId: 'stf_1',
  });
  assert.equal(validDry.ok, true);
  assert.equal(validDry.data.status, 'validated');
  assert.equal(state.transactions[0].rolledBack, true);
  assert.equal(state.transactions[0].committed, false);

  // 2. MetadataError during dryRun rejects with actionable column instead of reporting validated.
  state.hooks.saveProductMetadata = async () => {
    throw new MetadataError('A selected device model is unknown or inactive.');
  };
  const badMetaDry = await runCatalogueImport({
    filename: 'bad-meta.csv',
    csv: 'product_id,name,slug,category,price\nprod_1,Charger,existing-charger,Power,1999\n',
    dryRun: true,
    staffId: 'stf_1',
  });
  assert.equal(badMetaDry.ok, true);
  assert.equal(badMetaDry.data.status, 'rejected');
  assert.equal(badMetaDry.data.errors[0].rowNumber, 2);
  assert.equal(badMetaDry.data.errors[0].column, 'device_model_ids');
  state.hooks.saveProductMetadata = null;

  // 3. Category/product_type mismatch during update dryRun rejects cleanly.
  const badTypeDry = await runCatalogueImport({
    filename: 'bad-type.csv',
    csv: 'product_id,name,slug,category,price,product_type_id\nprod_1,Charger,existing-charger,Power,1999,pt_other\n',
    dryRun: true,
    staffId: 'stf_1',
  });
  assert.equal(badTypeDry.ok, true);
  assert.equal(badTypeDry.data.status, 'rejected');
  assert.equal(badTypeDry.data.errors[0].column, 'product_type_id');
});

test('ProductContentError and adjustVariantInventoryUsing errors convert to rejected rows with structured rollback logs', async () => {
  const { state, runCatalogueImport } = await buildHarness();

  // Client-fixable ProductContentError converts to rejected row, not 503.
  state.hooks.writeProductContent = async () => {
    throw new ProductContentError('Invalid product description.', 400);
  };
  const contentRes = await captureWarns(() =>
    runCatalogueImport({
      filename: 'content.csv',
      csv: 'product_id,name,slug,category,price,short_description\nprod_1,Charger,existing-charger,Power,1999,Bad\n',
      dryRun: false,
      staffId: 'stf_1',
    }),
  );
  assert.equal(contentRes.result.ok, true);
  assert.equal(contentRes.result.data.status, 'rejected');
  assert.equal(contentRes.result.data.errors[0].rowNumber, 2);
  assert.equal(contentRes.result.data.errors[0].column, 'short_description');
  assert.equal(contentRes.warns[0][0], '[store-admin/transfer] import rolled back');
  assert.equal(contentRes.warns[0][1].outcome, 'rejected');
  assert.equal(contentRes.warns[0][1].rowNumber, 2);
  assert.equal(contentRes.warns[0][1].errorName, 'MetadataImportError');
  state.hooks.writeProductContent = null;

  // Reserved stock violation inside adjustVariantInventoryUsing converts to rejected row.
  state.hooks.adjustVariantInventory = async () => {
    throw new Error('The count must be nonnegative and cover all reserved units.');
  };
  const stockRes = await captureWarns(() =>
    runCatalogueImport({
      filename: 'stock.csv',
      csv: 'product_id,name,slug,category,price,stock\nprod_1,Charger,existing-charger,Power,1999,2\n',
      dryRun: false,
      staffId: 'stf_1',
    }),
  );
  assert.equal(stockRes.result.ok, true);
  assert.equal(stockRes.result.data.status, 'rejected');
  assert.equal(stockRes.result.data.errors[0].rowNumber, 2);
  assert.equal(stockRes.result.data.errors[0].column, 'stock');
  assert.match(stockRes.result.data.errors[0].message, /reserved units/);
  state.hooks.adjustVariantInventory = null;

  // Client-fixable ProductContentError during create (`description_sections`) converts cleanly.
  state.hooks.writeProductContent = async () => {
    throw new ProductContentError('Product content exceeds the revision snapshot limit.', 400);
  };
  const createContentRes = await captureWarns(() =>
    runCatalogueImport({
      filename: 'create-content.csv',
      csv: 'name,slug,category,price,description_sections\nFresh Charger,fresh-charger,Power,1999,null\n',
      dryRun: false,
      staffId: 'stf_1',
    }),
  );
  assert.equal(createContentRes.result.ok, true);
  assert.equal(createContentRes.result.data.status, 'rejected');
  assert.equal(createContentRes.result.data.errors[0].rowNumber, 2);
  assert.equal(createContentRes.result.data.errors[0].column, 'description_sections');
});

test('Postgres unique constraint violation rejects with row/column and infra failures scrub DB URLs without leaking detail', async () => {
  const { state, MetadataError, runCatalogueImport } = await buildHarness();

  const pgDupError = Object.assign(
    new Error('duplicate key value violates unique constraint "products_slug_key"'),
    {
      name: 'PostgresError',
      code: '23505',
      constraint_name: 'products_slug_key',
      table_name: 'products',
      detail: 'Key (slug)=(new-slug) already exists. SENSITIVE_DETAIL_MUST_NOT_LEAK',
    },
  );
  state.hooks.onInsertProducts = async () => {
    throw pgDupError;
  };

  const dupRes = await captureWarns(() =>
    runCatalogueImport({
      filename: 'dup.csv',
      csv: 'name,slug,category,price\nNew One,new-slug,Power,1999\n',
      dryRun: false,
      staffId: 'stf_1',
    }),
  );
  assert.equal(dupRes.result.ok, true);
  assert.equal(dupRes.result.data.status, 'rejected');
  assert.equal(dupRes.result.data.errors[0].rowNumber, 2);
  assert.equal(dupRes.result.data.errors[0].column, 'slug');
  assert.equal(dupRes.warns[0][1].pgCode, '23505');
  assert.equal(dupRes.warns[0][1].constraint, 'products_slug_key');
  assert.equal(JSON.stringify(dupRes.warns).includes('SENSITIVE_DETAIL_MUST_NOT_LEAK'), false);
  assert.equal(dupRes.result.data.errors[0].message.includes('SENSITIVE_DETAIL_MUST_NOT_LEAK'), false);

  // Unexpected DB/infra failure stays `unavailable` and scrubs any connection URL.
  state.hooks.onInsertProducts = async () => {
    throw new Error('connect ECONNREFUSED postgres://admin:secret@db.internal:5432/gadzio');
  };
  const infraRes = await captureWarns(() =>
    runCatalogueImport({
      filename: 'infra.csv',
      csv: 'name,slug,category,price\nNew One,new-slug,Power,1999\n',
      dryRun: false,
      staffId: 'stf_1',
    }),
  );
  assert.equal(infraRes.result.ok, false);
  assert.equal(infraRes.result.reason, 'unavailable');
  assert.equal(infraRes.warns[0][1].outcome, 'unavailable');
  assert.equal(infraRes.warns[0][1].reason.includes('secret'), false);
  assert.equal(infraRes.warns[0][1].reason.includes('[redacted-db-url]'), true);
  state.hooks.onInsertProducts = null;

  // Update-path Postgres unique violation identifies the updated row & slug column.
  state.hooks.onUpdateProduct = async () => {
    throw Object.assign(
      new Error('duplicate key value violates unique constraint "products_slug_key"'),
      { name: 'PostgresError', code: '23505', constraint_name: 'products_slug_key', table_name: 'products' },
    );
  };
  const updateDupRes = await captureWarns(() =>
    runCatalogueImport({
      filename: 'update-dup.csv',
      csv: 'product_id,name,slug,category,price\nprod_1,Charger,swapped-slug,Power,1999\n',
      dryRun: false,
      staffId: 'stf_1',
    }),
  );
  assert.equal(updateDupRes.result.ok, true);
  assert.equal(updateDupRes.result.data.status, 'rejected');
  assert.equal(updateDupRes.result.data.errors[0].rowNumber, 2);
  assert.equal(updateDupRes.result.data.errors[0].column, 'slug');
  state.hooks.onUpdateProduct = null;

  // Audit persistence failure stays `unavailable` instead of blaming a CSV row.
  state.hooks.strictMetadataAudit = async () => {
    throw new MetadataError('The change was rolled back because its audit could not be saved.');
  };
  const auditFailRes = await captureWarns(() =>
    runCatalogueImport({
      filename: 'audit-fail.csv',
      csv: 'product_id,name,slug,category,price\nprod_1,Charger,existing-charger,Power,1999\n',
      dryRun: false,
      staffId: 'stf_1',
    }),
  );
  assert.equal(auditFailRes.result.ok, false);
  assert.equal(auditFailRes.result.reason, 'unavailable');
  assert.equal(auditFailRes.warns[0][1].outcome, 'unavailable');
});

test('postgresErrorToImportError maps product vs unrelated constraints without misreporting price_history_pkey on ₹1 imports', async () => {
  const { state, runCatalogueImport, postgresErrorToImportError } = await buildHarness();
  const sampleRows = [{ rowNumber: 2, slug: 'test-item', productId: 'test-item' }];

  // 1. products_slug_key -> slug
  const slugErr = postgresErrorToImportError(
    { code: '23505', constraint_name: 'products_slug_key', table_name: 'products', detail: 'Key (slug)=(test-item) already exists.' },
    sampleRows,
  );
  assert.equal(slugErr.column, 'slug');
  assert.equal(slugErr.rowNumber, 2);

  // 2. products_pkey -> product_id
  const pkeyErr = postgresErrorToImportError(
    { code: '23505', constraint_name: 'products_pkey', table_name: 'products', detail: 'Key (id)=(test-item) already exists.' },
    sampleRows,
  );
  assert.equal(pkeyErr.column, 'product_id');

  // 3. price_history_pkey -> database/import-level error, NOT 'price'
  const priceHistoryErr = postgresErrorToImportError(
    { code: '23505', constraint_name: 'price_history_pkey', table_name: 'price_history', column_name: 'id' },
    sampleRows,
  );
  assert.notEqual(priceHistoryErr.column, 'price');
  assert.equal(priceHistoryErr.column, 'import');
  assert.equal(priceHistoryErr.message.includes('price_history_pkey'), false);

  // Also ensure price_history_pkey without table_name still avoids 'price'.
  const priceHistoryNoTable = postgresErrorToImportError(
    { code: '23505', constraint_name: 'price_history_pkey' },
    sampleRows,
  );
  assert.equal(priceHistoryNoTable.column, 'import');

  // 4. Actual unambiguous product pricing constraints -> 'price'
  const productPriceCheck = postgresErrorToImportError(
    { code: '23514', constraint_name: 'products_price_paise_check', table_name: 'products', column_name: 'price_paise' },
    sampleRows,
  );
  assert.equal(productPriceCheck.column, 'price');

  const productPriceKey = postgresErrorToImportError(
    { code: '23505', constraint_name: 'products_price_paise_key', table_name: 'products', column_name: 'price_paise' },
    sampleRows,
  );
  assert.equal(productPriceKey.column, 'price');

  // Unrelated constraint whose name contains 'price' must NOT blame 'price'.
  const unrelatedPriceKey = postgresErrorToImportError(
    { code: '23505', constraint_name: 'unrelated_price_bucket_unique', table_name: 'other_table' },
    sampleRows,
  );
  assert.notEqual(unrelatedPriceKey.column, 'price');
  assert.equal(unrelatedPriceKey.column, 'import');

  // 5. Unknown 23505 constraint -> generic import error without raw DB detail
  const unknown23505 = postgresErrorToImportError(
    { code: '23505', constraint_name: 'some_custom_unique_idx', detail: 'INTERNAL_SECRET_ROW_VALUE' },
    sampleRows,
  );
  assert.equal(unknown23505.column, 'import');
  assert.equal(unknown23505.message, 'Duplicate record violates a unique catalogue constraint.');
  assert.equal(unknown23505.message.includes('INTERNAL_SECRET_ROW_VALUE'), false);

  // End-to-end ₹1 product update: when price_history_pkey collides on ₹1 change, error reports 'import' (never 'price').
  state.hooks.onInsertPriceHistory = async () => {
    throw Object.assign(
      new Error('duplicate key value violates unique constraint "price_history_pkey"'),
      { name: 'PostgresError', code: '23505', constraint_name: 'price_history_pkey', table_name: 'price_history', column_name: 'id' },
    );
  };
  const oneRupeeFail = await captureWarns(() =>
    runCatalogueImport({
      filename: 'one-rupee.csv',
      csv: 'product_id,name,slug,category,price\nprod_1,Charger,existing-charger,Power,1\n',
      dryRun: false,
      staffId: 'stf_1',
    }),
  );
  assert.equal(oneRupeeFail.result.ok, true);
  assert.equal(oneRupeeFail.result.data.status, 'rejected');
  assert.equal(oneRupeeFail.result.data.errors[0].column, 'import');
  assert.equal(oneRupeeFail.warns[0][1].pgCode, '23505');
  assert.equal(oneRupeeFail.warns[0][1].constraint, 'price_history_pkey');
  state.hooks.onInsertPriceHistory = null;

  // When price_history succeeds, ₹1 imports cleanly.
  const oneRupeeOk = await runCatalogueImport({
    filename: 'one-rupee-ok.csv',
    csv: 'product_id,name,slug,category,price\nprod_1,Charger,existing-charger,Power,1\n',
    dryRun: false,
    staffId: 'stf_1',
  });
  assert.equal(oneRupeeOk.ok, true);
  assert.equal(oneRupeeOk.data.status, 'imported');
  assert.equal(oneRupeeOk.data.updated, 1);
});
