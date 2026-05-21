<?php
/**
 * 投稿詳細テンプレート
 *
 * @package FlavorStreet
 */

get_header();
?>

<main class="fs-main">
	<section class="fs-page-hero fs-page-hero--compact">
		<div class="fs-page-hero__bg">
			<div class="fs-page-hero__overlay fs-page-hero__overlay--light"></div>
		</div>
		<div class="fs-page-hero__content fs-container">
			<p class="fs-page-hero__label">
				<?php
				$post_type = get_post_type();
				if ( $post_type === 'fs_news' ) {
					echo 'News';
				} elseif ( $post_type === 'fs_case' ) {
					echo 'Case Study';
				} else {
					echo 'Article';
				}
				?>
			</p>
			<h1 class="fs-page-hero__title"><?php the_title(); ?></h1>
			<time class="fs-page-hero__date" datetime="<?php echo get_the_date( 'Y-m-d' ); ?>">
				<?php echo get_the_date( 'Y年m月d日' ); ?>
			</time>
		</div>
	</section>

	<article class="fs-single fs-section">
		<div class="fs-container">
			<div class="fs-single__layout">
				<div class="fs-single__content">
					<?php if ( has_post_thumbnail() ) : ?>
						<div class="fs-single__thumbnail">
							<?php the_post_thumbnail( 'fs-gallery' ); ?>
						</div>
					<?php endif; ?>

					<div class="fs-single__body">
						<?php
						while ( have_posts() ) :
							the_post();
							the_content();
						endwhile;
						?>
					</div>

					<!-- 前後の記事ナビゲーション -->
					<nav class="fs-single__nav">
						<?php
						$prev = get_previous_post();
						$next = get_next_post();
						?>
						<?php if ( $prev ) : ?>
							<a href="<?php echo get_permalink( $prev ); ?>" class="fs-single__nav-link fs-single__nav-link--prev">
								<span class="fs-single__nav-label">&laquo; 前の記事</span>
								<span class="fs-single__nav-title"><?php echo esc_html( $prev->post_title ); ?></span>
							</a>
						<?php endif; ?>
						<?php if ( $next ) : ?>
							<a href="<?php echo get_permalink( $next ); ?>" class="fs-single__nav-link fs-single__nav-link--next">
								<span class="fs-single__nav-label">次の記事 &raquo;</span>
								<span class="fs-single__nav-title"><?php echo esc_html( $next->post_title ); ?></span>
							</a>
						<?php endif; ?>
					</nav>
				</div>
			</div>
		</div>
	</article>
</main>

<?php get_footer(); ?>
