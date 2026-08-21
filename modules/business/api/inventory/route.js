import { NextResponse } from "next/server";

import connectToDatabase from "@/lib/db/mongodb";
import { getBusinessAccess } from "@/modules/business/lib/access";
import { serializeImport } from "@/modules/business/lib/inventory";
import { InventoryImport, InventoryStock, Product, Warehouse } from "@/modules/business/models";

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function serializeProduct(product, stocks = []) {
  return {
    id: product._id.toString(),
    saleCode: product.saleCode,
    catalogCode: product.catalogCode || "",
    productCode: product.productCode || "",
    barcode: product.barcode || "",
    description: product.description || "",
    brand: product.brand || "",
    line: product.line || "",
    category: product.category || "",
    group: product.group || "",
    presentation: product.presentation || "",
    cost: product.cost || 0,
    salePrice: product.salePrice || 0,
    priceWithTax: product.priceWithTax || 0,
    discountedPriceWithTax: product.discountedPriceWithTax || 0,
    lastImportedAt: product.lastImportedAt,
    stocks,
    totalStock: stocks.reduce((sum, stock) => sum + (stock.quantity || 0), 0),
  };
}

export async function GET(request) {
  const access = await getBusinessAccess("business.inventory.view");
  if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });

  try {
    await connectToDatabase();
    const { searchParams } = new URL(request.url);
    const search = String(searchParams.get("search") || "").trim();
    const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1);
    const pageSize = 30;
    const query = search
      ? {
          $or: ["saleCode", "catalogCode", "productCode", "barcode", "description", "brand", "category"]
            .map((field) => ({ [field]: { $regex: escapeRegex(search), $options: "i" } })),
        }
      : {};

    const [products, totalProducts, warehouseCount, totals, imports] = await Promise.all([
      Product.find(query).sort({ description: 1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
      Product.countDocuments(query),
      Warehouse.countDocuments({ isActive: { $ne: false } }),
      InventoryStock.aggregate([
        { $group: { _id: null, totalQuantity: { $sum: "$quantity" }, totalValue: { $sum: "$totalValue" } } },
      ]),
      InventoryImport.find({}).sort({ createdAt: -1 }).limit(8).lean(),
    ]);
    const productIds = products.map((product) => product._id);
    const stockDocs = productIds.length
      ? await InventoryStock.find({ product: { $in: productIds } })
        .populate("warehouse", "name code isActive")
        .lean()
      : [];
    const stocksByProduct = new Map();

    stockDocs.forEach((stock) => {
      const key = stock.product.toString();
      const entries = stocksByProduct.get(key) || [];
      entries.push({
        warehouseId: stock.warehouse?._id?.toString() || "",
        warehouseName: stock.warehouse?.name || "Bodega eliminada",
        warehouseCode: stock.warehouse?.code || "",
        warehouseActive: stock.warehouse?.isActive !== false,
        quantity: stock.quantity || 0,
        fractionalQuantity: stock.fractionalQuantity || 0,
        totalValue: stock.totalValue || 0,
      });
      stocksByProduct.set(key, entries);
    });

    return NextResponse.json({
      products: products.map((product) => serializeProduct(product, stocksByProduct.get(product._id.toString()) || [])),
      pagination: { page, pageSize, total: totalProducts, pages: Math.max(1, Math.ceil(totalProducts / pageSize)) },
      summary: {
        productCount: await Product.countDocuments({}),
        warehouseCount,
        totalQuantity: totals[0]?.totalQuantity || 0,
        totalValue: totals[0]?.totalValue || 0,
      },
      imports: imports.map(serializeImport),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || "No se pudo cargar el inventario." }, { status: 500 });
  }
}
