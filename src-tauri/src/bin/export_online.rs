#[allow(dead_code)]
#[path = "../scanner/mod.rs"]
mod scanner;

use scanner::export_online_package_with_progress_impl;

fn main() {
    let mut args = std::env::args().skip(1);
    let Some(package_root) = args.next() else {
        eprintln!(
            "usage: export_online <package-root> [output-root] [public-base-url]\n\
             default output-root: ../private-assets/official/generated\n\
             default public-base-url: /official/generated"
        );
        std::process::exit(2);
    };

    let output_root = args.next().unwrap_or_default();
    let public_base_url = args.next().unwrap_or_default();

    match export_online_package_with_progress_impl(
        package_root,
        output_root,
        public_base_url,
        |message| {
            eprintln!("{message}");
        },
    ) {
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
