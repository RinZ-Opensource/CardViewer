#[allow(dead_code)]
#[path = "../scanner/mod.rs"]
mod scanner;

use scanner::export_mobile_pack_with_progress_impl;

fn main() {
    let mut args = std::env::args().skip(1);
    let Some(package_root) = args.next() else {
        eprintln!(
            "usage: export_mobile_pack <package-root> [output.cmpack]\n\
             default output: ../private-assets/official/mobile/CardMakerMobilePack.cmpack\n\
             set CARDVIEWER_MOBILE_REFERENCED_ONLY=1 for a smaller card-preview pack\n\
             set CARDVIEWER_MOBILE_CARD_LIMIT_PER_GAME=N and CARDVIEWER_MOBILE_SKIP_RAW=1 for smoke tests"
        );
        std::process::exit(2);
    };

    let output_path = args.next().unwrap_or_default();

    match export_mobile_pack_with_progress_impl(package_root, output_path, |message| {
        eprintln!("{message}");
    }) {
        Ok(result) => match serde_json::to_string_pretty(&result) {
            Ok(body) => println!("{body}"),
            Err(err) => {
                eprintln!("failed to serialize export result: {err}");
                std::process::exit(1);
            }
        },
        Err(err) => {
            eprintln!("{err}");
            std::process::exit(1);
        }
    }
}
