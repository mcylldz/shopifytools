import type { Handler } from '@netlify/functions'
import https from 'https'

const FAL_KEY = process.env.FAL_KEY || ''
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || ''
const GEMINI_KEY = process.env.GEMINI_API_KEY || ''
const OPENAI_KEY = process.env.OPENAI_API_KEY || ''

// ═══════════ HTTP Helper ═══════════
function httpsRequest(options: https.RequestOptions, payload?: string): Promise<{ status: number; body: string; headers?: Record<string, string | undefined> }> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve({ status: res.statusCode, body: '', headers: { location: res.headers.location as string } })
        res.resume()
        return
      }
      let data = ''
      res.on('data', (chunk: string) => (data += chunk))
      res.on('end', () => resolve({ status: res.statusCode || 500, body: data }))
    })
    req.on('error', reject)
    req.setTimeout(55000, () => { req.destroy(); reject(new Error('Request timeout')) })
    if (payload) req.write(payload)
    req.end()
  })
}

// ═══════════ Video Ad Modes — Higgsfield-Quality Presets ═══════════
// Each mode has model-specific system prompts optimized for that model's strengths
interface ModePrompts {
  base: string
  kling?: string
  veo?: string
  sora?: string
  minimax?: string
}

const VIDEO_MODE_PROMPTS: Record<string, ModePrompts> = {
  // ── Higgsfield-Style Modes ──
  'simple-ugc': {
    base: `You are an elite Meta Andromeda video ad director specializing in UGC-style content for women's fashion e-commerce.
Create a SIMPLE UGC video prompt: authentic, handheld feel, casual and relatable.
Key elements:
- Slight natural camera shake (not stabilized, feels phone-recorded)
- Natural indoor/outdoor lighting (window light, golden hour, NOT studio)
- Casual posing: adjusting clothes, checking mirror, quick spin
- Real-world environment: bedroom, cafe, street, fitting room
- First 0.5s: immediate product reveal, no slow intros
- 2-4 seconds total, vertical 9:16 format
- Warm color grade, slightly lifted blacks (Instagram aesthetic)
- NO text overlays in the video prompt itself
Output ONLY the prompt text, nothing else.`,
    kling: `Additional for Kling: Keep motion descriptions simple and physical. Focus on one clear action (e.g., "woman adjusts collar while looking at phone camera"). Use words: handheld, natural, casual, authentic. Avoid complex camera movements.`,
    veo: `Additional for Veo: Describe the scene cinematically but with UGC texture. Mention "shot on iPhone", "natural ambient light", "slight handheld movement". Veo responds well to environmental detail — describe the room/space.`,
    sora: `Additional for Sora: Focus on physics-based natural movement. Describe fabric drape, hair movement, body mechanics realistically. Sora excels at naturalistic motion — lean into that.`,
  },

  'clean-minimal': {
    base: `You are an elite Meta Andromeda video ad director specializing in clean minimalist e-commerce content for women's fashion.
Create a CLEAN MINIMAL video prompt: white/neutral backdrop, product-centric, modern.
Key elements:
- Pure white or soft cream cyclorama background
- Single dramatic shadow, crisp directional light
- Slow, deliberate product movement (gentle spin or float)
- Negative space emphasis — product occupies 60% of frame
- Sharp focus on product, everything else soft
- First 0.5s: product already in frame, instant visual clarity
- 2-4 seconds, vertical 9:16
- High-key lighting, desaturated palette
Output ONLY the prompt text, nothing else.`,
    kling: `Additional for Kling: Use minimal motion keywords. "Slow rotation", "gentle float", "subtle fabric sway". Keep CFG high for clean output. Specify "white studio background, single shadow".`,
    veo: `Additional for Veo: Veo handles studio environments well. Describe "infinite white cyclorama", "soft box lighting from upper right", "product centered in frame". Be precise about shadow direction and intensity.`,
    sora: `Additional for Sora: Describe the physics of the product movement. "Garment slowly rotates on invisible platform, fabric catches air gently". Sora needs physicality even in minimal scenes.`,
  },

  'luxury': {
    base: `You are an elite Meta Andromeda video ad director specializing in luxury fashion e-commerce content.
Create a LUXURY video prompt: cinematic, dramatic, aspirational, high-end.
Key elements:
- Rich, dramatic lighting: Rembrandt, butterfly, or rim lighting
- Dark moody background with selective illumination on product
- Slow-motion fabric movement (silk drape, cashmere texture)
- Dolly-in or slow push camera movement toward product
- Depth of field: razor-thin focus on product details
- Golden/warm highlights with deep shadow contrast
- First 0.5s: dramatic reveal with light sweep across product
- 3-5 seconds, vertical 9:16
- Premium materials feeling: gleam, sheen, texture depth
Output ONLY the prompt text, nothing else.`,
    kling: `Additional for Kling: Emphasize dramatic lighting with keywords: "cinematic rim light", "chiaroscuro", "dark luxury studio". Use "slow motion", "dramatic reveal". Kling handles dramatic lighting well.`,
    veo: `Additional for Veo: Describe the full cinematic setup: "Arri-style key light from 45 degrees", "negative fill on shadow side", "slow dolly push". Veo excels at cinematic language and camera movements.`,
    sora: `Additional for Sora: Focus on material physics: "silk catches light as it falls in slow motion", "fabric tension and release". Describe the interplay of light and material texture.`,
  },

  'product-story': {
    base: `You are an elite Meta Andromeda video ad director specializing in product narrative content for women's fashion.
Create a PRODUCT STORY video prompt: journey from flat product to styled look, mini narrative arc.
Key elements:
- Opening: product laid flat or folded beautifully
- Transition: hands picking up / unfolding the garment
- Reveal: product being held up, styled, or worn
- Emotional beat: confidence moment, fabric touch appreciation
- Camera follows the story: starts overhead, moves to eye-level
- Warm, editorial color grade
- First 0.5s: beautiful flat-lay composition hooks the viewer
- 3-5 seconds, vertical 9:16
- Tactile focus: fingers touching fabric, buttons, details
Output ONLY the prompt text, nothing else.`,
    kling: `Additional for Kling: Keep the narrative simple and action-based. "Hands unfold garment on marble surface, lift it to camera, fabric flows". Kling needs clear sequential actions.`,
    veo: `Additional for Veo: Describe the story as a single continuous shot. "Camera starts overhead on styled flat-lay, slowly tilts as hands enter frame and lift the garment". Veo handles continuous camera movements well.`,
    sora: `Additional for Sora: Focus on the physics of each transition. "Paper-thin fabric unfolds against gravity, hands guide it upward, material catches backlight as it rises". Sora loves physical interactions.`,
  },

  'cozy-morning': {
    base: `You are an elite Meta Andromeda video ad director specializing in lifestyle fashion content with a cozy, warm aesthetic.
Create a COZY MORNING video prompt: warm, intimate, soft, lifestyle-driven.
Key elements:
- Golden morning light streaming through sheer curtains
- Warm color temperature (2700K feel), soft shadows
- Intimate setting: bed, window seat, breakfast nook, bathroom mirror
- Gentle, slow movements: stretching, wrapping garment around body, coffee in hand
- Bokeh elements: out-of-focus plants, mugs, bedding
- Soft focus overall with occasional sharp moments on product
- First 0.5s: warm light and cozy environment establish mood instantly
- 3-5 seconds, vertical 9:16
- Hygge aesthetic: comfort, warmth, self-care moment
Output ONLY the prompt text, nothing else.`,
    kling: `Additional for Kling: Use warm, atmospheric keywords. "Soft morning sun through curtains", "gentle stretch in knit sweater", "warm bokeh background". Keep movements slow and gentle.`,
    veo: `Additional for Veo: Paint the full scene: "Golden hour light at 15-degree angle through linen curtains, dust particles visible in beam, woman in soft knitwear turns toward camera". Veo responds well to atmospheric descriptions.`,
    sora: `Additional for Sora: Describe the physics of comfort: "fabric drapes loosely over shoulders, steam rises from mug in background, curtain sways in gentle breeze". Sora handles atmospheric physics naturally.`,
  },

  'elegant-minimal': {
    base: `You are an elite Meta Andromeda video ad director specializing in sophisticated, refined fashion content.
Create an ELEGANT MINIMAL video prompt: understated luxury, refined movement, sophisticated.
Key elements:
- Neutral toned backdrop: warm grey, soft beige, muted stone
- Single elegant gesture: hand on fabric, shoulder turn, graceful step
- Architectural negative space with deliberate asymmetric composition
- Soft directional light with gentle gradient falloff
- Slow, purposeful camera drift (not static, not busy)
- Muted, desaturated palette with one subtle color accent from the product
- First 0.5s: striking composition with instant visual sophistication
- 3-5 seconds, vertical 9:16
- Editorial fashion magazine quality
Output ONLY the prompt text, nothing else.`,
    kling: `Additional for Kling: Use refined motion keywords. "Slow shoulder turn", "graceful hand gesture across fabric", "gentle camera drift right". Minimal action, maximum elegance.`,
    veo: `Additional for Veo: Describe like a fashion film: "Wes Anderson-inspired symmetry breaks as model turns 15 degrees, soft fill light creates gentle gradient on neutral linen backdrop". Veo responds to cinematic references.`,
    sora: `Additional for Sora: Focus on one refined motion: "fabric tension as shoulder rotates, creating a cascade of gentle folds that catch diffused side light". Sora captures subtle motion beautifully.`,
  },

  // ── Original Styles (Enhanced) ──
  'showcase-spin': {
    base: `You are an elite Meta Andromeda video ad director for women's fashion e-commerce.
Create a SHOWCASE SPIN video prompt: smooth 360-degree product rotation.
Key elements:
- Smooth, continuous 360° rotation on invisible turntable
- Studio lighting: 3-point setup with soft key, fill, and rim
- Clean background (white, gradient, or minimal context)
- Fabric movement during rotation: natural flow, no stiffness
- Product occupies 70-80% of frame
- First 0.5s: product already spinning, immediate visual interest
- 3-5 seconds for full rotation, vertical 9:16
- Sharp focus throughout rotation
Output ONLY the prompt text, nothing else.`,
    kling: `Additional for Kling: "Smooth continuous 360 rotation, studio lighting, white background". Kling handles rotations well with simple prompts.`,
    veo: `Additional for Veo: Describe the turntable mechanics: "Product on invisible rotating platform, completing full 360° rotation. Three-point lighting setup with soft shadows". Veo likes mechanical precision.`,
    sora: `Additional for Sora: Focus on fabric physics during rotation: "garment rotates smoothly, fabric hem lifts slightly from centrifugal movement, catching light at each angle". Sora handles rotation physics naturally.`,
  },

  'model-walk': {
    base: `You are an elite Meta Andromeda video ad director for women's fashion.
Create a MODEL WALK video prompt: confident runway or street-style walk.
Key elements:
- Confident, editorial walk: purposeful strides, slight hip sway
- Dynamic camera: tracking shot following the model or she walks toward camera
- Fabric movement: natural flow with each step, hem swing
- Urban or minimal backdrop: clean street, concrete wall, studio corridor
- Fashion editorial color grade: slightly desaturated with contrast
- First 0.5s: model already in motion, immediate dynamism
- 3-5 seconds, vertical 9:16, model centered
- Show full outfit with movement
Output ONLY the prompt text, nothing else.`,
    kling: `Additional for Kling: "Model walks confidently toward camera, editorial fashion style, tracking shot". Keep it action-focused. Kling needs clear motion direction.`,
    veo: `Additional for Veo: Describe the shot setup: "Steadicam tracking shot at waist height, model walks toward camera on grey concrete backdrop, natural side light creates depth". Veo handles complex camera movements.`,
    sora: `Additional for Sora: Describe the biomechanics: "confident walk with natural arm swing, fabric reacts to each stride with slight delay, heels click on polished floor". Sora excels at human motion.`,
  },

  'lifestyle-scene': {
    base: `You are an elite Meta Andromeda video ad director for women's fashion lifestyle content.
Create a LIFESTYLE SCENE video prompt: aspirational real-world setting.
Key elements:
- Beautiful real-world location: cafe terrace, coastal walkway, city rooftop, garden
- Natural golden hour or magic hour lighting
- Candid, unstaged feeling: laughing, looking away, moving through space
- Environmental context: coffee cup, book, architecture, nature
- Cinematic shallow depth of field
- First 0.5s: establishing the aspirational environment with product visible
- 3-5 seconds, vertical 9:16
- Emotionally engaging: viewer wants to be there
Output ONLY the prompt text, nothing else.`,
    kling: `Additional for Kling: Keep scenes simple with one clear action in one location. "Woman at cafe terrace, golden hour, touches hair and smiles". Kling works best with single-scene prompts.`,
    veo: `Additional for Veo: Full scene description: "Golden hour light at Mediterranean cafe terrace, woman in [product] sits at marble table, turns to camera with natural smile, bokeh background of warm string lights". Veo loves environmental detail.`,
    sora: `Additional for Sora: Describe atmospheric physics: "wind gently moves hair and fabric, warm sunlight creates lens flare through cafe awning, coffee steam rises in foreground bokeh". Sora nails atmospheric scenes.`,
  },

  'detail-zoom': {
    base: `You are an elite Meta Andromeda video ad director for premium fashion detail content.
Create a DETAIL ZOOM video prompt: macro close-up of fabric, stitching, details.
Key elements:
- Macro/close-up camera starting from product overview, zooming to detail
- Extreme shallow depth of field (f/1.4 feel)
- Texture emphasis: fabric weave, thread count, button detail, zipper
- Slow, smooth dolly-in or rack focus transition
- Directional side light to reveal texture dimensionality
- First 0.5s: movement already happening, draws eye in
- 2-4 seconds, vertical 9:16
- Tactile quality: viewer can "feel" the material
Output ONLY the prompt text, nothing else.`,
    kling: `Additional for Kling: "Slow zoom into fabric detail, macro close-up, shallow depth of field, side lighting". Keep it focused on one detail area.`,
    veo: `Additional for Veo: "Smooth dolly push from medium shot to extreme close-up of [detail], rack focus reveals texture depth, side light creates dimensional shadows across fabric weave". Veo handles focus transitions well.`,
    sora: `Additional for Sora: "Camera pushes slowly into fabric surface, individual threads become visible, light rakes across texture creating micro-shadows". Sora handles scale transitions and material detail well.`,
  },

  'before-after-reveal': {
    base: `You are an elite Meta Andromeda video ad director for fashion transformation content.
Create a BEFORE-AFTER REVEAL video prompt: flat product transforms to styled/worn look.
Key elements:
- Opening: beautifully styled flat-lay on clean surface
- Dramatic transition: unfold, lift, magic reveal, or morph
- Final: product worn/styled with confidence
- Wow factor in the transition moment
- Clean, bright lighting throughout
- First 0.5s: intriguing flat-lay composition
- 3-5 seconds, vertical 9:16
- Transformation creates curiosity and satisfaction
Output ONLY the prompt text, nothing else.`,
    kling: `Additional for Kling: "Product starts as flat-lay, hands lift and unfold it, transitions to being worn". Keep the transformation simple and physical.`,
    veo: `Additional for Veo: "Overhead shot of styled flat-lay on white marble, camera slowly tilts as garment begins to lift and unfold, morphing seamlessly into worn product at eye level". Veo can handle creative transitions.`,
    sora: `Additional for Sora: "Fabric defies gravity, rising from flat surface, unfolding and wrapping into worn position, each fold following natural drape physics". Sora excels at physics-defying but believable motion.`,
  },
}

// ═══════════ Fashion-Specific Negative Prompts ═══════════
const FASHION_NEGATIVE_PROMPTS: Record<string, string> = {
  default: 'blur, distortion, low quality, watermark, text overlay, deformed hands, extra fingers, unnatural fabric movement, stiff cloth, distorted body proportions, ugly, disfigured, low resolution, grainy, oversaturated',
  luxury: 'blur, distortion, low quality, watermark, text overlay, deformed hands, extra fingers, cheap fabric look, plastic texture, flat lighting, harsh shadows, amateur composition, oversaturated colors',
  ugc: 'blur, distortion, low quality, watermark, text overlay, deformed hands, extra fingers, overly polished, too perfect, studio lighting, artificial pose',
  minimal: 'blur, distortion, low quality, watermark, text overlay, deformed hands, extra fingers, cluttered background, busy composition, harsh colors, distracting elements',
}

function getNegativePrompt(mode: string): string {
  if (mode === 'luxury') return FASHION_NEGATIVE_PROMPTS.luxury
  if (mode === 'simple-ugc') return FASHION_NEGATIVE_PROMPTS.ugc
  if (['clean-minimal', 'elegant-minimal'].includes(mode)) return FASHION_NEGATIVE_PROMPTS.minimal
  return FASHION_NEGATIVE_PROMPTS.default
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  try {
    const body = JSON.parse(event.body || '{}')
    const { action } = body

    // ═══════════ GENERATE PROMPT (Claude Opus 4) ═══════════
    if (action === 'generate_prompt') {
      if (!ANTHROPIC_KEY) throw new Error('ANTHROPIC_API_KEY eksik')

      const { imageUrl, videoMode, videoModel, productTitle, productDescription } = body
      if (!imageUrl) throw new Error('imageUrl gerekli')

      const modeConfig = VIDEO_MODE_PROMPTS[videoMode]
      if (!modeConfig) throw new Error(`Gecersiz video modu: ${videoMode}`)

      // Build model-specific system prompt
      let systemPrompt = modeConfig.base

      // Add model-specific guidance
      const modelFamily = getModelFamily(videoModel || 'kling-video-v3-pro')
      const modelExtra = modeConfig[modelFamily as keyof ModePrompts]
      if (modelExtra && typeof modelExtra === 'string') {
        systemPrompt += '\n\n' + modelExtra
      }

      // Add Meta Andromeda compliance reminder
      systemPrompt += `\n\nCRITICAL Meta Andromeda Requirements:
- Vertical 9:16 format (mention this in the prompt)
- 2-5 seconds duration
- First 0.5 seconds must be visually arresting (thumb-stopping)
- Product must be clearly visible and the hero of the shot
- Motion must feel natural, not artificial or robotic
- No text, logos, or overlays in the video itself`

      let imageBlock: any
      if (imageUrl.startsWith('data:')) {
        const match = imageUrl.match(/^data:(image\/\w+);base64,(.+)$/)
        if (match) {
          imageBlock = { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } }
        }
      }
      if (!imageBlock) {
        imageBlock = { type: 'image', source: { type: 'url', url: imageUrl } }
      }

      const userContent = `Product: ${productTitle || 'Women\'s fashion garment'}
${productDescription ? `Description: ${productDescription}` : ''}
Target: Women's fashion e-commerce, Meta/Instagram Reels ad placement
Format: Vertical 9:16, 2-5 seconds

Analyze this product image carefully. Note the:
- Garment type, color, material/texture
- Key design details (cut, pattern, embellishments)
- Best angle and features to highlight

Generate a single, production-ready video prompt. Include specific: camera movement type, lighting setup, motion choreography, timing, and environment. Output ONLY the prompt text.`

      const payload = JSON.stringify({
        model: 'claude-opus-4-20250514',
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: userContent },
            imageBlock,
          ],
        }],
      })

      const result = await httpsRequest({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      }, payload)

      if (result.status !== 200) {
        console.error(`[video] Claude error: ${result.body.substring(0, 300)}`)
        throw new Error(`Claude API error (${result.status}): ${result.body.substring(0, 200)}`)
      }

      const data = JSON.parse(result.body)
      const prompt = data.content?.[0]?.text || ''
      const usage = data.usage || {}

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          prompt,
          negativePrompt: getNegativePrompt(videoMode),
          usage: {
            model: 'claude-opus-4-20250514',
            input_tokens: usage.input_tokens || 0,
            output_tokens: usage.output_tokens || 0,
          },
        }),
      }
    }

    // ═══════════ FAL VIDEO SUBMIT (Kling / MiniMax) ═══════════
    if (action === 'fal_video_submit') {
      if (!FAL_KEY) throw new Error('FAL_KEY eksik')

      const { model, payload: userPayload } = body
      if (!model) throw new Error('model gerekli')

      const FAL_VIDEO_MODELS: Record<string, string> = {
        'kling-video-v3-pro': '/fal-ai/kling-video/v3/pro/image-to-video',
        'minimax-hailuo': '/fal-ai/minimax/video-01/image-to-video',
      }

      const modelPath = FAL_VIDEO_MODELS[model]
      if (!modelPath) throw new Error(`Gecersiz video model: ${model}`)

      const falPayload = JSON.stringify(userPayload)
      console.log(`[video] fal_video_submit model=${model} path=${modelPath}`)

      const result = await httpsRequest({
        hostname: 'queue.fal.run',
        path: modelPath,
        method: 'POST',
        headers: {
          'Authorization': `Key ${FAL_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(falPayload),
        },
      }, falPayload)

      console.log(`[video] fal_video_submit response: ${result.status}`)
      if (!result.body || result.body.trim() === '') {
        throw new Error('FAL bos yanit dondu')
      }

      const falData = JSON.parse(result.body)
      if (result.status >= 400) {
        throw new Error(`FAL error (${result.status}): ${falData.detail || falData.message || JSON.stringify(falData).substring(0, 200)}`)
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, request_id: falData.request_id }),
      }
    }

    // ═══════════ FAL VIDEO STATUS / RESULT ═══════════
    if (action === 'fal_video_status') {
      if (!FAL_KEY) throw new Error('FAL_KEY eksik')
      if (!body.path) throw new Error('path gerekli')

      console.log(`[video] fal_video_status GET: ${body.path}`)

      const result = await httpsRequest({
        hostname: 'queue.fal.run',
        path: body.path,
        method: 'GET',
        headers: {
          'Authorization': `Key ${FAL_KEY}`,
          'Content-Type': 'application/json',
        },
      })

      if (!result.body || result.body.trim() === '') {
        throw new Error('FAL bos yanit dondu')
      }
      return {
        statusCode: result.status,
        headers: { 'Content-Type': 'application/json' },
        body: result.body,
      }
    }

    // ═══════════ GOOGLE VEO — predictLongRunning ═══════════
    if (action === 'veo_generate') {
      if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY eksik')

      const { prompt, imageUrl, veoModel, aspectRatio } = body

      // Fetch image and convert to base64
      let imageObj: any = null
      if (imageUrl) {
        try {
          let imageData: { mimeType: string; data: string } | null = null
          if (imageUrl.startsWith('data:')) {
            const match = imageUrl.match(/^data:(image\/\w+);base64,(.+)$/)
            if (match) imageData = { mimeType: match[1], data: match[2] }
          } else {
            const imgRes = await fetch(imageUrl)
            if (imgRes.ok) {
              const buffer = await imgRes.arrayBuffer()
              imageData = {
                mimeType: imgRes.headers.get('content-type') || 'image/jpeg',
                data: Buffer.from(buffer).toString('base64'),
              }
            }
          }
          if (imageData) {
            imageObj = { bytesBase64Encoded: imageData.data, mimeType: imageData.mimeType }
          }
        } catch (e) {
          console.warn(`[video] Image fetch failed for Veo: ${(e as Error).message}`)
        }
      }

      const model = veoModel || 'veo-2.0-generate-001'

      const instance: any = { prompt: prompt || '' }
      if (imageObj) instance.image = imageObj

      // Add generation config with aspect ratio
      const veoRequestBody: any = { instances: [instance] }
      if (aspectRatio) {
        veoRequestBody.parameters = { aspectRatio: aspectRatio }
      }

      const veoPayload = JSON.stringify(veoRequestBody)
      const veoPath = `/v1beta/models/${model}:predictLongRunning?key=${GEMINI_KEY}`

      console.log(`[video] Veo predictLongRunning, model=${model}, aspectRatio=${aspectRatio || 'default'}, prompt length=${prompt?.length || 0}`)

      const result = await httpsRequest({
        hostname: 'generativelanguage.googleapis.com',
        path: veoPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(veoPayload),
        },
      }, veoPayload)

      if (result.status !== 200) {
        console.error(`[video] Veo error: ${result.body.substring(0, 500)}`)
        throw new Error(`Veo API error (${result.status}): ${result.body.substring(0, 300)}`)
      }

      const veoData = JSON.parse(result.body)

      if (veoData.name) {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, operationName: veoData.name }),
        }
      }

      throw new Error('Veo operation name alinamadi: ' + JSON.stringify(veoData).substring(0, 300))
    }

    // ═══════════ VEO POLL ═══════════
    if (action === 'veo_poll') {
      if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY eksik')
      const { operationName } = body
      if (!operationName) throw new Error('operationName gerekli')

      const pollPath = `/v1beta/${operationName}?key=${GEMINI_KEY}`

      const result = await httpsRequest({
        hostname: 'generativelanguage.googleapis.com',
        path: pollPath,
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })

      if (result.status !== 200) {
        throw new Error(`Veo poll error (${result.status}): ${result.body.substring(0, 200)}`)
      }

      const opData = JSON.parse(result.body)

      if (opData.done) {
        const response = opData.response || {}
        const genResponse = response.generateVideoResponse || {}

        if (genResponse.raiMediaFilteredCount && genResponse.raiMediaFilteredCount > 0) {
          const reasons = genResponse.raiMediaFilteredReasons || []
          const reasonText = reasons.join('; ').substring(0, 200)
          throw new Error(`Video guvenlik filtresi: ${reasonText || 'Icerik politikasi nedeniyle video olusturulamadi. Farkli bir gorsel veya prompt deneyin.'}`)
        }

        const samples = genResponse.generatedSamples || []
        if (samples.length > 0) {
          const videoUri = samples[0].video?.uri
          if (videoUri) {
            return {
              statusCode: 200,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ success: true, done: true, videoUri }),
            }
          }
        }
        throw new Error('Veo tamamlandi ama video URI bulunamadi: ' + JSON.stringify(response).substring(0, 300))
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, done: false, metadata: opData.metadata || {} }),
      }
    }

    // ═══════════ VEO PROXY — Securely stream video without exposing API key ═══════════
    if (action === 'veo_proxy') {
      if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY eksik')
      const { videoUri } = body
      if (!videoUri) throw new Error('videoUri gerekli')

      // Add API key server-side and fetch the video
      const secureUri = videoUri.includes('?') ? `${videoUri}&key=${GEMINI_KEY}` : `${videoUri}?key=${GEMINI_KEY}`

      // Parse the URL to make the request
      const url = new URL(secureUri)

      const videoData = await new Promise<{ status: number; buffer: Buffer; contentType: string }>((resolve, reject) => {
        const req = https.request({
          hostname: url.hostname,
          path: url.pathname + url.search,
          method: 'GET',
        }, (res) => {
          // Handle redirect
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            // Follow redirect
            const redirectUrl = new URL(res.headers.location as string)
            const req2 = https.request({
              hostname: redirectUrl.hostname,
              path: redirectUrl.pathname + redirectUrl.search,
              method: 'GET',
            }, (res2) => {
              const chunks: Buffer[] = []
              res2.on('data', (chunk: Buffer) => chunks.push(chunk))
              res2.on('end', () => resolve({
                status: res2.statusCode || 500,
                buffer: Buffer.concat(chunks),
                contentType: (res2.headers['content-type'] || 'video/mp4') as string,
              }))
            })
            req2.on('error', reject)
            req2.setTimeout(55000, () => { req2.destroy(); reject(new Error('Redirect timeout')) })
            req2.end()
            res.resume()
            return
          }
          const chunks: Buffer[] = []
          res.on('data', (chunk: Buffer) => chunks.push(chunk))
          res.on('end', () => resolve({
            status: res.statusCode || 500,
            buffer: Buffer.concat(chunks),
            contentType: (res.headers['content-type'] || 'video/mp4') as string,
          }))
        })
        req.on('error', reject)
        req.setTimeout(55000, () => { req.destroy(); reject(new Error('Veo proxy timeout')) })
        req.end()
      })

      if (videoData.status !== 200 || videoData.buffer.length < 1000) {
        throw new Error(`Veo video indirilemedi (status: ${videoData.status}, size: ${videoData.buffer.length})`)
      }

      const base64 = videoData.buffer.toString('base64')
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          videoUrl: `data:${videoData.contentType};base64,${base64}`,
        }),
      }
    }

    // ═══════════ SORA — Submit Video ═══════════
    if (action === 'sora_submit') {
      if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY eksik')

      const { prompt, imageUrl, soraModel, size, seconds } = body

      // Build Sora payload with image support
      const soraPayload: any = {
        model: soraModel || 'sora-2',
        prompt: prompt || '',
      }
      if (size) soraPayload.size = size
      if (seconds) soraPayload.seconds = parseInt(String(seconds), 10)

      // Add image reference for image-to-video (Sora uses input_reference with image_url)
      if (imageUrl) {
        try {
          let dataUrl: string | null = null

          if (imageUrl.startsWith('data:')) {
            dataUrl = imageUrl
          } else {
            const imgRes = await fetch(imageUrl)
            if (imgRes.ok) {
              const buffer = await imgRes.arrayBuffer()
              const mimeType = imgRes.headers.get('content-type') || 'image/jpeg'
              dataUrl = `data:${mimeType};base64,${Buffer.from(buffer).toString('base64')}`
            }
          }

          if (dataUrl) {
            soraPayload.input_reference = { image_url: dataUrl }
          }
        } catch (e) {
          console.warn(`[video] Sora image input failed: ${(e as Error).message}`)
        }
      }

      const payload = JSON.stringify(soraPayload)
      console.log(`[video] sora_submit model=${soraModel || 'sora-2'}, hasImage=${!!soraPayload.input_reference}, size=${size}, seconds=${seconds}`)

      const result = await httpsRequest({
        hostname: 'api.openai.com',
        path: '/v1/videos',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      }, payload)

      console.log(`[video] sora_submit response: ${result.status}`)

      if (result.status !== 200 && result.status !== 201 && result.status !== 202) {
        console.error(`[video] Sora error: ${result.body.substring(0, 300)}`)
        throw new Error(`Sora API error (${result.status}): ${result.body.substring(0, 300)}`)
      }

      const soraData = JSON.parse(result.body)
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, id: soraData.id, status: soraData.status }),
      }
    }

    // ═══════════ SORA — Poll Status ═══════════
    if (action === 'sora_poll') {
      if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY eksik')
      const { videoId } = body
      if (!videoId) throw new Error('videoId gerekli')

      const result = await httpsRequest({
        hostname: 'api.openai.com',
        path: `/v1/videos/${videoId}`,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${OPENAI_KEY}`,
          'Content-Type': 'application/json',
        },
      })

      if (result.status !== 200) {
        throw new Error(`Sora poll error (${result.status}): ${result.body.substring(0, 200)}`)
      }

      const soraData = JSON.parse(result.body)
      console.log(`[video] Sora poll status=${soraData.status}, keys=${Object.keys(soraData).join(',')}`)

      if (soraData.status === 'completed') {
        let videoUrl = soraData.output?.url
          || soraData.url
          || soraData.video?.url
          || soraData.result?.url
          || soraData.output_video?.url
          || soraData.downloads?.url
          || null

        if (!videoUrl && Array.isArray(soraData.output)) {
          videoUrl = soraData.output[0]?.url || soraData.output[0]?.video?.url || null
        }

        // Try content download endpoint
        if (!videoUrl) {
          try {
            const contentResult = await httpsRequest({
              hostname: 'api.openai.com',
              path: `/v1/videos/${videoId}/content`,
              method: 'GET',
              headers: { 'Authorization': `Bearer ${OPENAI_KEY}` },
            })

            if (contentResult.headers?.location) {
              videoUrl = contentResult.headers.location
            } else if (contentResult.status === 200) {
              try {
                const contentData = JSON.parse(contentResult.body)
                videoUrl = contentData.url || contentData.download_url || null
              } catch {
                console.log(`[video] Sora content non-JSON, body length=${contentResult.body.length}`)
              }
            }
          } catch (e) {
            console.warn(`[video] Sora content fetch failed: ${(e as Error).message}`)
          }
        }

        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, done: true, videoUrl }),
        }
      }

      if (soraData.status === 'failed') {
        throw new Error('Sora video uretimi basarisiz: ' + (soraData.error?.message || 'Bilinmeyen hata'))
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, done: false, status: soraData.status }),
      }
    }

    // ═══════════ SORA — Download Video Content ═══════════
    if (action === 'sora_download') {
      if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY eksik')
      const { videoId } = body
      if (!videoId) throw new Error('videoId gerekli')

      console.log(`[video] sora_download videoId=${videoId}`)

      const videoData = await new Promise<{ status: number; buffer: Buffer; headers: Record<string, string> }>((resolve, reject) => {
        const req = https.request({
          hostname: 'api.openai.com',
          path: `/v1/videos/${videoId}/content`,
          method: 'GET',
          headers: { 'Authorization': `Bearer ${OPENAI_KEY}` },
        }, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            resolve({ status: res.statusCode, buffer: Buffer.alloc(0), headers: { location: res.headers.location as string } })
            res.resume()
            return
          }
          const chunks: Buffer[] = []
          res.on('data', (chunk: Buffer) => chunks.push(chunk))
          res.on('end', () => resolve({
            status: res.statusCode || 500,
            buffer: Buffer.concat(chunks),
            headers: { 'content-type': (res.headers['content-type'] || '') as string },
          }))
        })
        req.on('error', reject)
        req.setTimeout(55000, () => { req.destroy(); reject(new Error('Sora download timeout')) })
        req.end()
      })

      if (videoData.headers.location) {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, videoUrl: videoData.headers.location }),
        }
      }

      if (videoData.status === 200 && videoData.buffer.length > 1000) {
        const base64 = videoData.buffer.toString('base64')
        const mimeType = videoData.headers['content-type'] || 'video/mp4'
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, videoUrl: `data:${mimeType};base64,${base64}` }),
        }
      }

      const bodyPreview = videoData.buffer.toString('utf-8').substring(0, 200)
      throw new Error(`Sora video indirilemedi (status: ${videoData.status}, size: ${videoData.buffer.length}, body: ${bodyPreview})`)
    }

    // ═══════════ DOWNLOAD PROXY — Secure cross-origin video download ═══════════
    if (action === 'download_proxy') {
      const { videoUrl } = body
      if (!videoUrl) throw new Error('videoUrl gerekli')

      // Don't proxy data: URLs
      if (videoUrl.startsWith('data:')) {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, videoUrl }),
        }
      }

      const url = new URL(videoUrl)
      const videoData = await new Promise<{ status: number; buffer: Buffer; contentType: string }>((resolve, reject) => {
        const req = https.request({
          hostname: url.hostname,
          path: url.pathname + url.search,
          method: 'GET',
          headers: { 'User-Agent': 'ShopifyTools/1.0' },
        }, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const rUrl = new URL(res.headers.location as string)
            const req2 = https.request({
              hostname: rUrl.hostname,
              path: rUrl.pathname + rUrl.search,
              method: 'GET',
            }, (res2) => {
              const chunks: Buffer[] = []
              res2.on('data', (chunk: Buffer) => chunks.push(chunk))
              res2.on('end', () => resolve({
                status: res2.statusCode || 500,
                buffer: Buffer.concat(chunks),
                contentType: (res2.headers['content-type'] || 'video/mp4') as string,
              }))
            })
            req2.on('error', reject)
            req2.setTimeout(55000, () => { req2.destroy(); reject(new Error('Redirect timeout')) })
            req2.end()
            res.resume()
            return
          }
          const chunks: Buffer[] = []
          res.on('data', (chunk: Buffer) => chunks.push(chunk))
          res.on('end', () => resolve({
            status: res.statusCode || 500,
            buffer: Buffer.concat(chunks),
            contentType: (res.headers['content-type'] || 'video/mp4') as string,
          }))
        })
        req.on('error', reject)
        req.setTimeout(55000, () => { req.destroy(); reject(new Error('Download proxy timeout')) })
        req.end()
      })

      if (videoData.status !== 200 || videoData.buffer.length < 100) {
        throw new Error(`Video indirilemedi (status: ${videoData.status})`)
      }

      const base64 = videoData.buffer.toString('base64')
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          videoUrl: `data:${videoData.contentType};base64,${base64}`,
        }),
      }
    }

    return { statusCode: 400, body: JSON.stringify({ error: `Gecersiz action: ${action}` }) }

  } catch (err: any) {
    console.error(`[video] Error: ${err.message}`)
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}

// Helper: determine model family for prompt specialization
function getModelFamily(videoModel: string): string {
  if (videoModel.includes('kling')) return 'kling'
  if (videoModel.includes('veo')) return 'veo'
  if (videoModel.includes('sora')) return 'sora'
  if (videoModel.includes('minimax') || videoModel.includes('hailuo')) return 'minimax'
  return 'kling'
}
