const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');
const pdf = require('pdf-parse');
const AdmZip = require('adm-zip');
const app = express();
const port = process.env.PORT || 3000;

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = 'uploads/';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir);
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

// Serve static files
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// PDF Merge API
app.post('/api/merge', upload.array('pdfs', 10), async (req, res) => {
    try {
        const mergedPdf = await PDFDocument.create();
        const files = req.files;
        
        if (!files || files.length < 2) {
            return res.status(400).json({ error: 'Please upload at least 2 PDF files' });
        }
        
        for (const file of files) {
            const pdfBytes = fs.readFileSync(file.path);
            const pdfDoc = await PDFDocument.load(pdfBytes);
            const pages = await mergedPdf.copyPages(pdfDoc, pdfDoc.getPageIndices());
            pages.forEach(page => mergedPdf.addPage(page));
            
            // Delete the temporary file
            fs.unlinkSync(file.path);
        }
        
        const mergedPdfBytes = await mergedPdf.save();
        const resultFileName = `merged_${Date.now()}.pdf`;
        const resultPath = path.join('results', resultFileName);
        
        if (!fs.existsSync('results')) {
            fs.mkdirSync('results');
        }
        
        fs.writeFileSync(resultPath, mergedPdfBytes);
        
        // Set the file to be deleted after 1 hour
        setTimeout(() => {
            if (fs.existsSync(resultPath)) {
                fs.unlinkSync(resultPath);
            }
        }, 3600000);
        
        res.json({ 
            success: true,
            downloadUrl: `/download/${resultFileName}`
        });
        
    } catch (error) {
        console.error('Merge error:', error);
        res.status(500).json({ error: 'Error merging PDFs' });
    }
});

// PDF Split API
app.post('/api/split', upload.single('pdf'), async (req, res) => {
    try {
        const { pages } = req.body;
        const file = req.file;
        
        if (!file) {
            return res.status(400).json({ error: 'Please upload a PDF file' });
        }
        
        const pdfBytes = fs.readFileSync(file.path);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const pageCount = pdfDoc.getPageCount();
        
        const pageRanges = parsePageRanges(pages, pageCount);
        if (!pageRanges || pageRanges.length === 0) {
            fs.unlinkSync(file.path);
            return res.status(400).json({ error: 'Invalid page range' });
        }
        
        const zip = new AdmZip();
        const resultFiles = [];
        
        for (const range of pageRanges) {
            const newPdf = await PDFDocument.create();
            const pages = await newPdf.copyPages(pdfDoc, range);
            pages.forEach(page => newPdf.addPage(page));
            
            const newPdfBytes = await newPdf.save();
            const fileName = `split_${range[0] + 1}-${range[range.length - 1] + 1}_${Date.now()}.pdf`;
            const filePath = path.join('results', fileName);
            
            fs.writeFileSync(filePath, newPdfBytes);
            zip.addLocalFile(filePath);
            resultFiles.push(filePath);
        }
        
        // Delete the original uploaded file
        fs.unlinkSync(file.path);
        
        const zipFileName = `split_results_${Date.now()}.zip`;
        const zipPath = path.join('results', zipFileName);
        zip.writeZip(zipPath);
        
        // Set files to be deleted after 1 hour
        setTimeout(() => {
            resultFiles.forEach(file => {
                if (fs.existsSync(file)) {
                    fs.unlinkSync(file);
                }
            });
            if (fs.existsSync(zipPath)) {
                fs.unlinkSync(zipPath);
            }
        }, 3600000);
        
        res.json({ 
            success: true,
            downloadUrl: `/download/${zipFileName}`
        });
        
    } catch (error) {
        console.error('Split error:', error);
        res.status(500).json({ error: 'Error splitting PDF' });
    }
});

// Download route
app.get('/download/:filename', (req, res) => {
    const filePath = path.join('results', req.params.filename);
    
    if (fs.existsSync(filePath)) {
        res.download(filePath, err => {
            if (err) {
                console.error('Download error:', err);
            }
        });
    } else {
        res.status(404).send('File not found');
    }
});

// Helper function to parse page ranges
function parsePageRanges(ranges, pageCount) {
    if (!ranges) return null;
    
    const result = [];
    const parts = ranges.split(',');
    
    for (const part of parts) {
        if (part.includes('-')) {
            const [start, end] = part.split('-').map(num => parseInt(num.trim()) - 1);
            
            if (isNaN(start) || isNaN(end) || start < 0 || end >= pageCount || start > end) {
                return null;
            }
            
            const range = [];
            for (let i = start; i <= end; i++) {
                range.push(i);
            }
            result.push(range);
        } else {
            const pageNum = parseInt(part.trim()) - 1;
            
            if (isNaN(pageNum) || pageNum < 0 || pageNum >= pageCount) {
                return null;
            }
            
            result.push([pageNum]);
        }
    }
    
    return result;
}

// Start server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
