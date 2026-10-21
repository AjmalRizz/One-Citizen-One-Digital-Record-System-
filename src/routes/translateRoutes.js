const express = require('express');
const router = express.Router();
const { translateNameToSinhalaAndTamil, NAME_DICTIONARY } = require('../utils/translator');

/**
 * GET /api/translate/name?name=Wasim+Bari+Ahmadh+Bilaal
 * POST /api/translate/name  { name: "Wasim Bari Ahmadh Bilaal" }
 * Returns auto-transliterated Sinhala and Tamil names
 */
router.get('/name', async (req, res) => {
  try {
    const name = (req.query.name || '').trim();
    if (!name) {
      return res.status(200).json({ success: true, sinhala: '', tamil: '' });
    }
    const result = await translateNameToSinhalaAndTamil(name);
    return res.status(200).json({
      success: true,
      original: name,
      sinhala: result.sinhala,
      tamil: result.tamil
    });
  } catch (err) {
    console.error('[translate error]', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/name', async (req, res) => {
  try {
    const name = (req.body?.name || req.body?.full_name || '').trim();
    if (!name) {
      return res.status(200).json({ success: true, sinhala: '', tamil: '' });
    }
    const result = await translateNameToSinhalaAndTamil(name);
    return res.status(200).json({
      success: true,
      original: name,
      sinhala: result.sinhala,
      tamil: result.tamil
    });
  } catch (err) {
    console.error('[translate error]', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Provide common dictionary for client-side instant caching
router.get('/dictionary', (req, res) => {
  return res.status(200).json({
    success: true,
    dictionary: NAME_DICTIONARY
  });
});

module.exports = router;
