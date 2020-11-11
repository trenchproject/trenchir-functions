// Required dependencies (installed via npm in Kudu)
const execFile = require('child_process').execFile;
const exiftool = require('dist-exiftool');
const fs = require('fs');

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
                    var rawtype = metadata.RawThermalImageType;
                    var embedtype = metadata.EmbeddedImageType;
                    var pR1 = metadata.PlanckR1;

                    // Ends function if no planck constants
                    if(!pR1){ 
                        fs.unlink(filename+"."+ogtype, (err) => {
                            if (err) throw err;
                            context.log('successfully deleted ' + filename+"."+ogtype);
                        });
                        blockBlobClient.delete();
                        throw "Unsupported filetype. Unable to extract necessary metadata for conversion, no planck constants.";
                    }

                    // Extracting raw thermal image
                    execFile(exiftool, [filename+"."+ogtype, '-b', '-RawThermalImage', '-w', "-RAW."+rawtype], (error, stdout, stderr) => {
                        if (err) {
                            context.error(`exec error: ${error}`);
                            throw "Error extracting RawThermalImage. Unsupported filetype.";
                        }

                        context.log("Temp RAW file was saved to:  ", __dirname + '\\' + filename+"-RAW."+rawtype);
                        
                        // Reading in raw thermal image
                        fs.readFile(filename+"-RAW."+rawtype, (err, rawimg) => {
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
                    });
                } catch(err) {throw "Unsupported filetype. Unable to extract necessary metadata for conversion.";}
            });
        }
    });
};
