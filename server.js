import express from "express";
import fs from "fs";
import path from "path";
import qrCodeReader from "qrcode-reader";
import { Jimp } from "jimp";
import { PDFDocument } from "pdf-lib";
import { SignPdf } from "node-signpdf";
import { plainAddPlaceholder } from "node-signpdf/dist/helpers/index.js";
import { connectToDatabase } from "./connection.js";
import dotenv from "dotenv";
import { createCanvas } from "canvas";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const CERTIFICATE_PATH = "./certificados/SALES DISTRIBUIDORA LTDA.pfx";
const CERTIFICATE_PASSWORD = "123456";

async function createPDFWithImageAndTemplate(imagePath, outputPath) {
  try {
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Arquivo de imagem não encontrado: ${imagePath}`);
    }

    const pdfDoc = await PDFDocument.create();

    const imageBytes = fs.readFileSync(imagePath);
    const image = await pdfDoc.embedJpg(imageBytes);
    const { width, height } = image.scale(1);

    const page = pdfDoc.addPage([width + 100, height + 150]);
    page.drawImage(image, {
      x: 50,
      y: 100,
      width,
      height,
    });

    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, pdfBytes);
    console.log(`✅ PDF criado com imagem: ${outputPath}`);
  } catch (error) {
    console.error(`❌ Erro ao criar PDF:`, error.message);
    throw error;
  }
}

async function createSignatureImage(certificateInfo, outputPath) {
  try {
    const canvas = createCanvas(1600, 400);
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "rgba(255, 255, 255, 0)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#000000";
    ctx.font = "bold 40px Arial";

    const text = `Assinado por: ${certificateInfo.name}\nCNPJ: ${
      certificateInfo.cnpj
    }\nData: ${new Date().toLocaleString()}`;
    const lines = text.split("\n");
    const lineHeight = 40;
    lines.forEach((line, index) => {
      ctx.fillText(line, 50, 100 + index * lineHeight);
    });

    const out = fs.createWriteStream(outputPath);
    const stream = canvas.createPNGStream();
    stream.pipe(out);

    out.on("finish", () => {
      console.log(`✅ Imagem de assinatura criada e salva em: ${outputPath}`);
    });

    out.on("error", (err) => {
      console.error(`❌ Erro ao salvar a imagem de assinatura: ${err.message}`);
    });
  } catch (error) {
    console.error(`❌ Erro ao criar imagem de assinatura:`, error.message);
    throw error;
  }
}

async function addSignatureImageToPDF(pdfPath, imagePath, outputPath) {
  try {
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Arquivo de imagem não encontrado: ${imagePath}`);
    }

    const pdfBytes = fs.readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);

    const imageBytes = fs.readFileSync(imagePath);
    const image = await pdfDoc.embedPng(imageBytes);
    const { width, height } = image.scale(0.8);

    const pages = pdfDoc.getPages();
    const firstPage = pages[0];
    firstPage.drawImage(image, {
      x: 100,
      y: 100,
      width,
      height,
    });

    const modifiedPdfBytes = await pdfDoc.save({ useObjectStreams: false });
    fs.writeFileSync(outputPath, modifiedPdfBytes);
    console.log(`✅ Imagem de assinatura adicionada ao PDF: ${outputPath}`);
  } catch (error) {
    console.error(`❌ Erro ao adicionar imagem ao PDF:`, error.message);
    throw error;
  }
}

async function signPDF(pdfPath, signedPdfPath, pfxPath, passphrase) {
  try {
    console.log(`📝 Preparando o PDF para assinatura: ${pdfPath}`);
    let pdfBuffer = fs.readFileSync(pdfPath);

    // Adicionar espaço reservado para assinatura
    pdfBuffer = plainAddPlaceholder({
      pdfBuffer,
      reason: "Assinatura Digital",
      signatureLength: 16384, // Tamanho do espaço da assinatura
    });

    // Carregar o certificado
    const pfxBuffer = fs.readFileSync(pfxPath);
    const signer = new SignPdf();
    const signedPdf = signer.sign(pdfBuffer, pfxBuffer, { passphrase });

    fs.writeFileSync(signedPdfPath, signedPdf);
    console.log(`✅ PDF assinado com sucesso: ${signedPdfPath}`);
  } catch (error) {
    console.error(`❌ Erro ao assinar PDF:`, error.message);
    throw error;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processImages(directory) {
  const files = fs
    .readdirSync(directory)
    .filter((file) => file.endsWith(".png") || file.endsWith(".jpg"));

  for (const file of files) {
    const filePath = path.join(directory, file);
    try {
      const pdfFileName = `processed_${file.replace(/\.(jpg|png)$/, ".pdf")}`;
      const pdfPath = path.join(directory, pdfFileName);
      await createPDFWithImageAndTemplate(filePath, pdfPath);

      const signatureImagePath = path.join(
        directory,
        `signature_${file.replace(/\.(jpg|png)$/, ".jpg")}`
      );
      await createSignatureImage(
        {
          name: "SALES DISTRIBUIDORA LTDA",
          cnpj: "47.978.428/0001-77",
        },
        signatureImagePath
      );
      console.log(`Caminho da imagem de assinatura: ${signatureImagePath}`);

      await delay(1000);

      const pdfWithSignatureImagePath = path.join(
        directory,
        `with_signature_image_${pdfFileName}`
      );
      await addSignatureImageToPDF(
        pdfPath,
        signatureImagePath,
        pdfWithSignatureImagePath
      );

      const signedPdfFileName = `signed_${file.replace(
        /\.(jpg|png)$/,
        ".pdf"
      )}`;
      const signedPdfPath = path.join(directory, signedPdfFileName);
      await signPDF(
        pdfWithSignatureImagePath,
        signedPdfPath,
        CERTIFICATE_PATH,
        CERTIFICATE_PASSWORD
      );

      fs.unlinkSync(pdfPath);
      fs.unlinkSync(signatureImagePath);
      fs.unlinkSync(pdfWithSignatureImagePath);
      console.log(
        `🗑️ Arquivos intermediários excluídos: ${pdfPath}, ${signatureImagePath}, ${pdfWithSignatureImagePath}`
      );

      console.log(`✅ PDF assinado salvo: ${signedPdfPath}`);
    } catch (error) {
      console.error(`Erro ao processar ${file}:`, error.message);
    }
  }
}

app.get("/scan-images", async (req, res) => {
  const { scanner, userName } = req.query;
  if (!scanner || !userName) {
    return res
      .status(400)
      .json({ error: "Parâmetros scanner e userName são obrigatórios" });
  }

  const directory = `\\\\172.16.0.20\\repository\\scanner\\${scanner}\\${userName}`;
  if (!fs.existsSync(directory)) {
    return res.status(404).json({ error: "Diretório não encontrado" });
  }

  try {
    const [rows] = await connectToDatabase.execute(
      "SELECT * FROM empresa_notas_emitentes"
    );
    const validCNPJs = rows.map((row) => ({
      id: row.emi_id,
      cnpj: row.emi_cnpj,
    }));

    await processImages(directory, validCNPJs);
    res.json({ message: "Processamento concluído" });
  } catch (error) {
    console.error(`Erro geral:`, error.message);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
