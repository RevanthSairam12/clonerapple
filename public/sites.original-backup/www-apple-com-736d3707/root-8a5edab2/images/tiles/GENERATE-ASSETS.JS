const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const input = process.argv[2];

if (!input) {
    console.log("Usage: node generate-assets.js <image-path>");
    process.exit(1);
}

if (!fs.existsSync(input)) {
    console.log("❌ Input image not found:", input);
    process.exit(1);
}

const outputDir = path.join(__dirname, "output");

fs.mkdirSync(outputDir, { recursive: true });

const sizes = [
    ["small", 230],
    ["small_2x", 460],
    ["medium", 460],
    ["medium_2x", 920],
    ["large", 592],
    ["large_2x", 1184],
];

async function generate() {
    const image = sharp(input);

    for (const [name, width] of sizes) {
        const outputPath = path.join(
            outputDir,
            `image_${name}.png`
        );

        await image
            .clone()
            .resize({
                width: width,
                fit: "inside",
                withoutEnlargement: false
            })
            .png()
            .toFile(outputPath);

        console.log(`✅ Generated: ${outputPath}`);
    }

    console.log("\n🎉 All images generated!");
}

generate().catch((error) => {
    console.error("❌ Error:", error);
});