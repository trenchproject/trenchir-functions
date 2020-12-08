// Required dependencies (installed via npm in Kudu)
const execFile = require('child_process').execFile;
const exiftool = require('dist-exiftool');
const fs = require('fs');
const gm = require('gm');

// Function triggered by new blob in "uploads" folder
module.exports = function(context, myBlob) {
    var ogtype = context.bindingData.name.split(".")[1];
    var filename = context.bindingData.name.split(".")[0];
    context.log("Converting blob: ", filename+"."+ogtype);

    // Writing blob to function storage to allow command line tools to convert
    fs.writeFile(filename+"."+ogtype, myBlob, function(err) {
        if (err) {
            context.error(err);
            throw "Can't find server, contact TrEnCh-IR team";
        } else {
            context.log("Temp og file was saved to:   ", __dirname + '\\' + filename+"."+ogtype);

            // Pulling metadata from og file
            execFile(exiftool, ['-j', filename+"."+ogtype], (error, stdout, stderr) => {
                
                if (err) {
                    context.error(`exec error: ${error}`);
                    fs.unlink(filename+"."+ogtype, (err) => {
                        if (err) throw err;
                        context.log('successfully deleted ' + filename+"."+ogtype);
                    });
                    throw "Can't open metadata";
                }

                // Formatting metadata variables 
                try{ 
                    var metadata = JSON.parse(stdout);
                    metadata = metadata[0];
                    context.log("metadata raw thermal image type: " + metadata.RawThermalImageType);
                    context.log("metadata og image type: " + ogtype);


                    var embedtype = metadata.EmbeddedImageType;
                    var pR1 = metadata.PlanckR1;
                    var rawwidth = metadata.RawThermalImageWidth;
                    var rawheight = metadata.RawThermalImageHeight;
                    var rawtype = metadata.RawThermalImageType;
                    var resolution = rawwidth.toString()+"x"+rawheight.toString();

                    // Ends function if no planck constants
                    if(!pR1){ 
                        context.log("No planck constant");
                        fs.unlink(filename+"."+ogtype, (err) => {
                            if (err) throw err;
                            context.log('successfully deleted ' + filename+"."+ogtype);
                        });
                        blockBlobClient.delete();
                        throw "Unsupported filetype. Unable to extract necessary metadata for conversion, no planck constants.";
                    }

                    // Extracting raw thermal image
                    execFile(exiftool, [filename+"."+ogtype, '-b', '-RawThermalImage', '-w', "-rawtemp.tiff"], (err) => {
                        if (err) {
                            context.log(err);
                        }

                        context.log("Temp RAW file was saved to:  ", __dirname + '\\' + filename+"-rawtemp.tiff");

                        context.log("next command: " + filename + "-rawtemp.tiff raw.gray");

                        gm(filename+"-rawtemp.tiff")
                        .write('raw.gray', function (err) {
                            if (err) context.log(err);
                            context.log("writing raw.gray");
                        });

                        context.log("convert 1");

                        if(rawtype=="PNG" || rawtype=="png"){
                            gm('raw.gray')
                            .bitdepth(16)
                            .endian('MSB')
                            .write(filename+"-RAW.tiff", function (err) {
                                if (err) context.log(err);
                                context.log("writing raw");
                            });

                            // Reading in raw thermal image
                            fs.readFile(filename+"-RAW.tiff", (err, rawimg) => {
                                if (err) {
                                    context.log(err);
                                    throw "Error reading RawThermalImage. Unsupported filetype.";
                                }

                                // Extracting embedded image
                                execFile(exiftool, [filename+"."+ogtype, '-b', '-EmbeddedImage', '-w', "-EMBED."+embedtype], (error, stdout, stderr) => {
                                    if (err) {context.log("No embedded image...");} 
                                    else     {context.log("Temp embed file was saved to:", __dirname + '\\' + filename+"-EMBED."+embedtype);}
                                    
                                    // Reading in embedded image
                                    fs.readFile(filename+"-EMBED."+embedtype, (err, embeddedimg) => {
                                        if (err) context.log(err);
                                        else context.log("Embedded file successful upload to:  /embed/EMBED-"+filename+"."+ogtype);

                                        // Setting output data
                                        context.bindings.outputembed = embeddedimg;
                                        context.bindings.output = rawimg;
                                        context.bindings.outputog = myBlob;
                                        context.bindings.outputparam = metadata;

                                        context.log("Original file successful upload to:  /originals/"+filename+"."+ogtype);
                                        context.log("RAW file successful upload to:       /raw/RAW-"+filename+"."+ogtype+"."+rawtype);
                                        context.log("Parameter file successful upload to: /param/PARAM-"+filename+"."+ogtype+".json");
                                        

                                        // Deleting local temporary files
                                        fs.unlink(filename+"-EMBED."+embedtype, (err) => {
                                            if (err) context.log(err);
                                            context.log('successfully deleted ' + filename+"-EMBED."+embedtype);
                                        });
                                        fs.unlink(filename+"."+ogtype, (err) => {
                                            if (err) context.log(err);
                                            context.log('successfully deleted ' + filename+"."+ogtype);
                                        });
                                        fs.unlink(filename+"-RAW."+rawtype, (err) => {
                                            if (err) context.log(err);
                                            context.log('successfully deleted ' + filename+"."+rawtype);
                                        });

                                        context.done(); // End of function
                                    });
                                });
                            });
                        } else {
                            throw "ERROR: Unrecognized raw image type.";
                        }
                    });
                } catch(err) {
                    context.log(err.message);
                    context.log("Error caught");
                    fs.unlink(filename+"."+ogtype, (err) => {
                        if (err) throw err;
                        context.log('successfully deleted ' + filename+"."+ogtype);
                    });
                    fs.unlink(filename+"-rawtemp.tiff", (err) => {
                        if (err) throw err;
                        context.log('successfully deleted ' + filename+"-rawtemp.tiff");
                    });
                }
            });
        }
    });
};
