/**
 * Loads slightly modified Tiled-format json map data into the Isogenic Engine.
 */
var IgeTiledComponent = IgeClass.extend({
	classId: 'IgeTiledComponent',
	componentId: 'tiled',

	/**
	 * @constructor
	 * @param entity
	 * @param options
	 */
	init: function (entity, options) {
		this._entity = entity;
		this._options = options;
	},

	/**
	 * Loads a .js Tiled json-format file and converts to IGE format,
	 * then calls the callback with the newly created scene and the
	 * various layers as IgeTextureMap instances.
	 * @param url
	 * @param callback
	 */
	loadJson: function (url, callback) {
		var self = this,
			scriptElem;

		if (typeof (url) === 'string') {
			if (ige.isClient) {
				scriptElem = document.createElement('script');
				scriptElem.src = url;
				scriptElem.onload = function () {
					self.log('Tiled data loaded, processing...');
					self._processData(tiled, callback);
				};
				document.getElementsByTagName('head')[0].appendChild(scriptElem);
			} else {
				IgeTiledComponent.prototype.log('URL-based Tiled data is only available client-side. If you want to load Tiled map data on the server please include the map file in your ServerConfig.js file and then specify the map\'s data object instead of the URL.', 'error');
			}
		} else {
			self._processData(url, callback);
		}
	},

	_processData: function (data, callback) {

		if (ige.isServer && (data == undefined || data.layers == undefined)) {
			IgeTiledComponent.prototype.log("layer doesn't exist. unpublishing...")
			ige.server.unpublish('IgeTiledComponent#51')
		}

		var mapClass = ige.isServer === true ? IgeTileMap2d : IgeTextureMap,
			mapWidth = data.width,
			mapHeight = data.height,
			layerArray = data.layers,
			layerCount = layerArray ? layerArray.length : 0,
			layer,
			layerType,
			layerData,
			layerDataCount,
			maps = [],
			layersById = {},
			tileSetArray = data.tilesets,
			tileSetCount = tileSetArray ? tileSetArray.length : 0,
			tileSetItem,
			tileSetsTotal = tileSetCount,
			tileSetsLoaded = 0,
			textureCellLookup = [],
			currentTexture,
			currentCell,
			onLoadFunc,
			image,
			textures = [],
			allTexturesLoadedFunc,
			i, k, x, y, z,
			ent;

		if (ige.isClient) {
			ige.layersById = layersById;
		}


		// Define the function to call when all textures have finished loading
		allTexturesLoadedFunc = function () {
			// Create a map for each layer
			for (i = 0; i < layerCount; i++) {
				layer = layerArray[i];
				layerType = layer.type;

				// Check if the layer is a tile layer or an object layer
				if (layerType === 'tilelayer') {
					layerData = layer.data;

					IgeTiledComponent.prototype.log("setting " + layer.name + " to depth " + i)

					maps[i] = new mapClass(data.tilewidth, data.tileheight);

					if (typeof maps[i].tileWidth == 'function') {
						maps[i].tileWidth(data.tilewidth)
							.tileHeight(data.tilewidth)
							.depth(i);
					}
					else {
						IgeTiledComponent.prototype.log("ERROR while loading map. Chris might have fixed this")
						ige.server.unpublish('IgeTiledComponent#109')
						return;
					}

					maps[i].type = layerType;
					maps[i].name = layer.name;

					// Check if the layer should be isometric mounts enabled
					if (data.orientation === 'isometric') {
						maps[i].isometricMounts(true);
					}

					layersById[layer.name] = maps[i];
					tileSetCount = tileSetArray.length;

					if (ige.isClient) {
						for (k = 0; k < tileSetCount; k++) {
							maps[i].addTexture(textures[k]);
						}
					}

					// Loop through the layer data and paint the tiles
					layerDataCount = layerData.length;

					for (y = 0; y < mapHeight; y++) {
						for (x = 0; x < mapWidth; x++) {
							z = x + (y * mapWidth);

							if (layerData[z] > 0 && layerData[z] !== 2147483712) {
								if (ige.isClient) {
									// Paint the tile
									currentTexture = textureCellLookup[layerData[z]];
									if (currentTexture) {
										currentCell = layerData[z] - (currentTexture._tiledStartingId - 1);
										maps[i].paintTile(x, y, maps[i]._textureList.indexOf(currentTexture), currentCell);
									}
								} else {
									// Server-side we don't paint tiles on a texture map
									// we just mark the map data so that it can be used
									// to do things like path-finding and auto-creating
									// static physics objects.
									maps[i].occupyTile(x, y, 1, 1, layerData[z]);
								}
							}
						}
					}
				}

				if (layerType === 'objectgroup') {
					maps[i] = layer;
					layersById[layer.name] = maps[i];
				}
			}

			callback(maps, layersById);
		};

		if (ige.isClient) {
			onLoadFunc = function (textures, tileSetCount, tileSetItem) {
				return function () {
					var i, cc

					var imageUrl = tileSetItem.image;
					var scaleFactor = ige.scaleMapDetails.scaleFactor;

					if (imageUrl.includes('tilesheet') || tileSetCount === 0) {
						tileSetItem.tilewidth = ige.scaleMapDetails.originalTileWidth;
						tileSetItem.tileheight = ige.scaleMapDetails.originalTileHeight;
					}

					var cs = new IgeCellSheet(imageUrl, this.width * scaleFactor.x / tileSetItem.tilewidth, this.height * scaleFactor.y / tileSetItem.tileheight, ige.scaleMapDetails.shouldScaleTilesheet)
						.id(tileSetItem.name)
						.on('loaded', function () {
							if (ige.scaleMapDetails.shouldScaleTilesheet && (imageUrl.includes('tilesheet') || tileSetCount === 0)) {
								this.resize(this._sizeX * scaleFactor.x, this._sizeY * scaleFactor.y)
							}
							cc = this.cellCount();

							this._tiledStartingId = tileSetItem.firstgid;
							// Fill the lookup array
							for (i = 0; i < cc; i++) {
								textureCellLookup[this._tiledStartingId + i] = this;
							}

							textures.push(this);

							tileSetsLoaded++;

							if (tileSetsLoaded === tileSetsTotal) {
								// All textures loaded, fire processing function
								allTexturesLoadedFunc();
							}
						});
				};
			};

			// Load the tile sets as textures
			while (tileSetCount--) {
				// Load the image into memory first so we can read the total width and height
				image = new Image();

				
				tileSetItem = tileSetArray[tileSetCount];
				image.onload = onLoadFunc(textures, tileSetCount, tileSetItem);

				image.src = tileSetItem.image;

			}
		} else {
			// We're on the server so no textures are actually loaded
			allTexturesLoadedFunc();
		}
	}
});

if (typeof (module) !== 'undefined' && typeof (module.exports) !== 'undefined') { module.exports = IgeTiledComponent; }